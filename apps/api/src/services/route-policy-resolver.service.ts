import type { JobPriority, WebhookRoutePolicy } from '@printerops/domain';
import { ValidationError } from '@printerops/shared';

export interface ResolvedRoute {
  printerCode: string;
  templateCode: string;
  mappedPayload: Record<string, unknown>;
  priority: JobPriority;
}

function fieldValue(payload: Record<string, unknown>, path: string): unknown {
  const clean = path.startsWith('$.') ? path.slice(2) : path;
  return clean.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, payload);
}

function resolveMapping(mapping: Record<string, unknown>, payload: Record<string, unknown>, key: string): string {
  const strategy = mapping['strategy'];
  if (strategy === 'static') {
    const value = mapping[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  if (strategy === 'field') {
    const field = mapping['field'];
    if (typeof field !== 'string') throw new ValidationError(`Invalid field mapping for ${key}`);
    const value = fieldValue(payload, field);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  throw new ValidationError(`Unable to resolve ${key}`);
}

function priorityFrom(value: unknown): JobPriority {
  return value === 'urgent' || value === 'high' || value === 'low' ? value : 'normal';
}

export class RoutePolicyResolverService {
  resolve(policy: WebhookRoutePolicy, payload: Record<string, unknown>): ResolvedRoute {
    if (!policy.enabled) throw new ValidationError('Route policy disabled');
    this.assertNoRawJs(policy);
    this.assertMatches(policy, payload);

    const mappedPayload: Record<string, unknown> = {};
    for (const [target, sourcePath] of Object.entries(policy.payloadMapping)) {
      mappedPayload[target] = fieldValue(payload, sourcePath);
    }

    const priorityMapping = policy.priorityMapping ?? {};
    const priority =
      priorityMapping['strategy'] === 'field' && typeof priorityMapping['field'] === 'string'
        ? priorityFrom(fieldValue(payload, priorityMapping['field']))
        : priorityFrom(priorityMapping['priority']);

    return {
      printerCode: resolveMapping(policy.printerMapping, payload, 'printer_code'),
      templateCode: resolveMapping(policy.templateMapping, payload, 'template_code'),
      mappedPayload,
      priority,
    };
  }

  private assertMatches(policy: WebhookRoutePolicy, payload: Record<string, unknown>): void {
    for (const rule of policy.matchRules.when) {
      if (rule.op !== 'eq') throw new ValidationError(`Unsupported match op: ${rule.op}`);
      if (fieldValue(payload, rule.field) !== rule.value) {
        throw new ValidationError(`Route policy ${policy.policyCode} did not match`);
      }
    }
  }

  private assertNoRawJs(policy: WebhookRoutePolicy): void {
    const raw = JSON.stringify(policy);
    if (raw.includes('eval(') || raw.includes('Function(') || raw.includes('=>')) {
      throw new ValidationError('Raw JavaScript expressions are not allowed in route policies');
    }
  }
}
