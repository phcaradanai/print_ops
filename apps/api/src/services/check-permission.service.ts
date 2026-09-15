import type { PermissionPolicyPort, PermissionContext, Permission, EventBusPort } from '@printerops/domain';
import { generateId, PermissionError } from '@printerops/shared';

export class CheckPermissionService {
  constructor(
    private policy: PermissionPolicyPort,
    private events: EventBusPort
  ) {}

  can(ctx: PermissionContext, permission: Permission): boolean {
    return this.policy.can(ctx, permission);
  }

  assertCan(ctx: PermissionContext, permission: Permission): void {
    if (!this.policy.can(ctx, permission)) {
      this.events.publish({
        eventId: generateId(),
        eventType: 'PermissionDenied',
        traceId: generateId(),
        correlationId: generateId(),
        occurredAt: new Date(),
        userId: ctx.userId,
        permission,
        resource: permission.split(':')[0] ?? permission,
      });
      throw new PermissionError(permission);
    }
  }
}
