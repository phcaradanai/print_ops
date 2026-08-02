import type {
  JobCallbackIntent,
  CallbackTransport,
  WebhookEndpoint,
  WebhookEndpointRepositoryPort,
} from '@printerops/domain';
import { AppError } from '@printerops/shared';
import { resolveCallbackDestination } from './webhook-callback.service.js';
import { assertCallbackUrlAllowed, CallbackUrlRejected } from '../infra/http/callback-url-guard.js';

/**
 * Turns a WebhookEndpoint plus the ORIGINAL intake payload into the immutable
 * `JobCallbackIntent` stored with the job.
 *
 * Three things are settled here and never re-derived later:
 *
 *  1. Whether result callbacks are on. `callbackOnPrintResult` was a UI toggle
 *     that no dispatch code read — this is the only place it now decides
 *     anything, and a disabled endpoint still gets an intent (with
 *     `enabled: false` and a reason) so the Job Detail page can say WHY nothing
 *     was delivered instead of showing a blank.
 *  2. The literal destinations. `$.field` destinations resolve against the
 *     intake payload, which does not survive to terminal time.
 *  3. That the HTTP destination passed the SSRF guard. Doing it at accept time
 *     means a caller-supplied `http://169.254.169.254/...` is refused while
 *     there is still someone to return an error to.
 *
 * Endpoint edits after this point do not change where an already-accepted job
 * reports its result. That is deliberate: an operator repointing a webhook must
 * not silently redirect results for prints that are already on the wire.
 */
export function buildCallbackIntent(
  endpoint: WebhookEndpoint,
  intakePayload: Record<string, unknown>,
): JobCallbackIntent {
  const base = {
    trigger: 'PRINT_RESULT' as const,
    endpointId: endpoint.id,
    endpointCode: endpoint.endpointCode,
  };
  const transport = endpoint.callbackTransport ?? 'NONE';

  if (transport === 'NONE') {
    return { ...base, enabled: false, transports: [], disabledReason: 'endpoint callbackTransport is NONE' };
  }
  const transports: CallbackTransport[] = [];
  const intent: JobCallbackIntent = { ...base, enabled: false, transports };
  intent.callbackSigningSecretRef = endpoint.callbackSigningSecretRef;

  if (transport === 'HTTP' || transport === 'BOTH') {
    const url = resolveCallbackDestination(endpoint.callbackUrl, intakePayload);
    if (url) {
      // Validate now, while a 4xx can still reach the caller. Storing an intent
      // whose URL the sender will refuse anyway only produces a delivery that
      // is born FAILED.
      assertCallbackUrlAllowed(url);
      intent.httpUrl = url;
      transports.push('HTTP');
    }
  }

  if (transport === 'NATS' || transport === 'BOTH') {
    const subject = resolveCallbackDestination(endpoint.callbackNatsSubject, intakePayload);
    if (subject) {
      intent.natsSubject = subject;
      // Core only. The print-intake connection deliberately does not own a
      // stream, so PrintOps cannot promise JetStream durability on a
      // caller-supplied reply subject. Labelled honestly rather than implied.
      intent.natsMode = 'CORE';
      transports.push('NATS');
    }
  }

  intent.enabled = transports.length > 0;
  if (!intent.enabled) {
    intent.disabledReason = `callbackTransport ${transport} is configured but no destination could be resolved from the payload`;
  }
  return intent;
}

/**
 * Resolve an `endpoint_code` supplied on an intake request into a callback
 * intent, with the validation that must happen BEFORE anything is printed.
 *
 * Shared by every intake path that accepts `endpoint_code` (the dynamic print
 * endpoint, the NATS envelope, POST /api/v1/print-jobs) so all of them apply
 * the same rules:
 *
 *   - the endpoint exists and is enabled
 *   - it belongs to the caller's `source_system` (one client must not be able
 *     to route its results through another client's destination)
 *   - its destination survives the SSRF guard
 *
 * Rejecting here rather than at delivery time matters: a print that has already
 * produced a physical page cannot be un-printed, so a caller whose contract
 * requires a callback must be told the reference is bad while it can still be
 * fixed. Returns undefined when no `endpoint_code` was supplied at all — that
 * is the backward-compatible "I do not want callbacks" case.
 */
export async function resolveEndpointCallbackIntent(
  endpoints: WebhookEndpointRepositoryPort | undefined,
  endpointCode: string | undefined,
  sourceSystem: string,
  intakePayload: Record<string, unknown>,
): Promise<JobCallbackIntent | undefined> {
  const code = endpointCode?.trim();
  if (!endpoints) {
    // Backward-compatible deployments and focused service tests may not
    // provide an endpoint repository. That is safe only when the caller did
    // not request a callback at all.
    if (!code) return undefined;
    throw new AppError(
      'CALLBACK_ENDPOINT_UNAVAILABLE',
      'Callback endpoints are not available on this deployment.',
      503,
    );
  }

  const endpoint = code
    ? await endpoints.findByCode(code)
    : await findDefaultCallbackEndpoint(endpoints, sourceSystem);
  if (!endpoint && !code) return undefined;
  if (!endpoint || !endpoint.enabled) {
    throw new AppError(
      'CALLBACK_ENDPOINT_NOT_FOUND',
      `endpoint_code '${code}' does not exist or is disabled`,
      422,
    );
  }
  if (endpoint.sourceSystem !== sourceSystem) {
    throw new AppError(
      'CALLBACK_ENDPOINT_FORBIDDEN',
      `endpoint_code '${code}' does not belong to source_system '${sourceSystem}'`,
      403,
    );
  }

  try {
    return buildCallbackIntent(endpoint, intakePayload);
  } catch (err) {
    if (err instanceof CallbackUrlRejected) {
      throw new AppError('CALLBACK_DESTINATION_REJECTED', err.message, 422);
    }
    throw err;
  }
}

/**
 * Publishers do not need to repeat endpoint_code when their source system has
 * one unambiguous configured callback destination. Multiple matches require an
 * explicit endpoint_code so routing never depends on repository ordering.
 */
export async function findDefaultCallbackEndpoint(
  endpoints: WebhookEndpointRepositoryPort,
  sourceSystem: string,
): Promise<WebhookEndpoint | undefined> {
  const matches = (await endpoints.findAll()).filter((endpoint) =>
    endpoint.enabled &&
    endpoint.sourceSystem === sourceSystem &&
    (endpoint.callbackTransport ?? 'NONE') !== 'NONE'
  );
  if (matches.length > 1) {
    throw new AppError(
      'CALLBACK_ENDPOINT_AMBIGUOUS',
      `Multiple callback endpoints are configured for source_system '${sourceSystem}'; endpoint_code is required`,
      422,
    );
  }
  return matches[0];
}

/** Convenience wrapper: never throws, folding an SSRF rejection into a disabled
 *  intent. Used on paths where refusing the print over a bad callback URL would
 *  be worse than printing without one — currently none, but the accept paths
 *  choose explicitly rather than by accident. */
export function buildCallbackIntentSafe(
  endpoint: WebhookEndpoint,
  intakePayload: Record<string, unknown>,
): JobCallbackIntent {
  try {
    return buildCallbackIntent(endpoint, intakePayload);
  } catch (err) {
    return {
      enabled: false,
      trigger: 'PRINT_RESULT',
      transports: [],
      endpointId: endpoint.id,
      endpointCode: endpoint.endpointCode,
      disabledReason:
        err instanceof CallbackUrlRejected ? `${err.code}: ${err.message}` : String(err),
    };
  }
}
