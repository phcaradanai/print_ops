import { describe, it, expect, vi } from 'vitest';
import { RbacPermissionPolicy } from '../infra/permission/rbac-permission.policy.js';
import { CheckPermissionService } from '../services/check-permission.service.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import type { PermissionContext, AnyDomainEvent } from '@printerops/domain';
import { PermissionError } from '@printerops/shared';

const viewerCtx: PermissionContext = { userId: 'u1', role: 'VIEWER' };
const adminCtx: PermissionContext = { userId: 'u2', role: 'ADMIN' };
const ownerCtx: PermissionContext = { userId: 'u3', role: 'OWNER' };

describe('RbacPermissionPolicy', () => {
  const policy = new RbacPermissionPolicy();

  it('denies VIEWER for job:create', () => {
    expect(policy.can(viewerCtx, 'job:create')).toBe(false);
  });

  it('allows ADMIN for job:create', () => {
    expect(policy.can(adminCtx, 'job:create')).toBe(true);
  });

  it('allows OWNER for all permissions', () => {
    const ownerPerms: import('@printerops/domain').Permission[] = [
      'printer:read', 'printer:create', 'printer:update', 'printer:control',
      'job:create', 'job:read', 'job:cancel', 'job:retry',
      'runner:read', 'runner:manage',
      'audit:read', 'trace:read', 'export:read',
      'user:manage', 'role:manage',
    ];
    for (const p of ownerPerms) {
      expect(policy.can(ownerCtx, p)).toBe(true);
    }
  });

  it('assertCan throws for VIEWER on job:create', () => {
    expect(() => policy.assertCan(viewerCtx, 'job:create')).toThrow(PermissionError);
  });

  it('assertCan does not throw for ADMIN on job:create', () => {
    expect(() => policy.assertCan(adminCtx, 'job:create')).not.toThrow();
  });
});

describe('CheckPermissionService', () => {
  it('publishes PermissionDenied event and throws on denial', async () => {
    const eventBus = new InMemoryEventBus();
    const captured: AnyDomainEvent[] = [];
    eventBus.subscribe('PermissionDenied', (e) => { captured.push(e); });

    const svc = new CheckPermissionService(new RbacPermissionPolicy(), eventBus);

    expect(() => svc.assertCan(viewerCtx, 'job:create')).toThrow(PermissionError);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.eventType).toBe('PermissionDenied');
    expect((captured[0] as import('@printerops/domain').PermissionDenied).permission).toBe('job:create');
    expect((captured[0] as import('@printerops/domain').PermissionDenied).userId).toBe('u1');
  });

  it('does not publish event when permission is granted', () => {
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');
    const svc = new CheckPermissionService(new RbacPermissionPolicy(), eventBus);

    expect(() => svc.assertCan(adminCtx, 'job:create')).not.toThrow();
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
