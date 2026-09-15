import type {
  JobCallbackIntent,
  CallbackTransport,
  WebhookEndpoint,
  WebhookEndpointRepositoryPort,
} from '@printerops/domain';
import { AppError } from '@printerops/shared';
import { resolveCallbackDestination } from './webhook-callback.service.js';
import { callbackNatsModeFromEnv } from './result-callback-dispatcher.js';
import { assertCallbackUrlAllowed, CallbackUrlRejected } from '../infra/http/callback-url-guard.js';

/**
 * Turns a WebhookEndpoint plus the ORIGINAL intake payload into the immutable
 * `JobCallbackIntent` stored with the job.
 *
 * Three things are settled here and never re-derived later:
 *
 *  1. Whether result callbacks are on. Every job with a resolvable callback
 *     destination gets a terminal-result callback — the toggle only silences
 *     the ACCEPTANCE callback (see wantsAcceptanceCallback). A disabled
 *     endpoint (no transport / no resolvable destination) still gets an
 *     intent (with `enabled: false` and a reason) so the Job Detail page can
 *     say WHY nothing was delivered instead of showing a blank.
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
      // Snapshotted at accept time, like every other destination here: changing
      // the deployment setting must not silently alter the delivery contract of
      // a print already on the wire. JETSTREAM (at-least-once, deduped on
      // Nats-Msg-Id) is the default; PrintOps still never creates the stream —
      // if the receiving environment owns none, the delivery fails visibly with
      // NATS_NO_STREAM rather than pretending to a guarantee it did not get.
      intent.natsMode = callbackNatsModeFromEnv();
      transports.push('NATS');
    }
  }

  intent.enabled = transports.length > 0;
  if (!intent.enabled) {
    intent.disabledReason = `callbackTransport ${transport} is configured but no destination could be resolved from the payload`;
  }
  // Snapshot the payload template with the intent so the TERMINAL callback can
  // resolve it too (against the v2 envelope + the stored intake payload). The
  // acceptance callback resolves it against the intake response.
  if (endpoint.callbackPayloadTemplate && Object.keys(endpoint.callbackPayloadTemplate).length > 0) {
    intent.payloadTemplate = endpoint.callbackPayloadTemplate;
  }
  return intent;
}

/**
 * Which of the two callbacks an endpoint has asked for.
 *
 * `callbackOnPrintResult` was persisted and shown in the Webhooks UI but read
 * by no dispatch code. Today the terminal-result callback fires for EVERY job
 * that has a resolvable callback destination — the toggle is read only here,
 * and only to decide whether the ACCEPTANCE callback also fires (an
 * "acceptance mode" endpoint hears about the print twice: once when it is
 * queued, once when it terminates; a "result mode" endpoint hears only the
 * terminal result). Every intake path goes through these two helpers, so no
 * entry point can special-case the flag (see
 * docs/architecture/result-callbacks.md §1).
 */
export function wantsTerminalCallback(endpoint: WebhookEndpoint): boolean {
  return endpoint.callbackOnPrintResult === true;
}

/**
 * A duplicate creates no new print, so it can never reach a terminal state:
 * acceptance is its final outcome whatever the toggle says. Without this
 * exception, a caller resending a request_id to an endpoint in result mode
 * would be told nothing at all, ever.
 */
export function wantsAcceptanceCallback(endpoint: WebhookEndpoint, duplicate: boolean): boolean {
  if ((endpoint.callbackTransport ?? 'NONE') === 'NONE') return false;
  return duplicate || !wantsTerminalCallback(endpoint);
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
  return (await resolveCallbackEndpoint(endpoints, endpointCode, sourceSystem, intakePayload))?.intent;
}

export interface ResolvedCallbackEndpoint {
  endpoint: WebhookEndpoint;
  intent: JobCallbackIntent;
}

/**
 * As `resolveEndpointCallbackIntent`, but also hands back the endpoint it
 * validated.
 *
 * The acceptance callback needs the endpoint itself — its transport, its
 * destinations, its payload template — not just the derived terminal intent.
 * Exposed here rather than re-looked-up by the caller so the exists / enabled /
 * source_system ownership rules stay in exactly one place; duplicating them was
 * the alternative, and one copy drifting is how a client ends up able to route
 * results through another client's destination.
 */
export async function resolveCallbackEndpoint(
  endpoints: WebhookEndpointRepositoryPort | undefined,
  endpointCode: string | undefined,
  sourceSystem: string,
  intakePayload: Record<string, unknown>,
): Promise<ResolvedCallbackEndpoint | undefined> {
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
    return { endpoint, intent: buildCallbackIntent(endpoint, intakePayload) };
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
