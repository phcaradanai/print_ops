# Permission Model

## RBAC Roles

| Role | Description |
|------|-------------|
| OWNER | Full access including user/role management |
| ADMIN | Full operational access, no user management |
| OPERATOR | Can create/cancel jobs and control printers |
| VIEWER | Read-only access |

## Permissions

```
printer:read     printer:create   printer:update   printer:control
job:create       job:read         job:cancel       job:retry
runner:read      runner:manage
audit:read       trace:read       export:read
user:manage      role:manage
```

## Implementation

`RbacPermissionPolicy` implements `PermissionPolicyPort`.
`CheckPermissionService.assertCan()` throws `PermissionError` (HTTP 403) and publishes `PermissionDenied` event + audit log entry.

## Adding Permission Checks to Routes

```typescript
const permCtx = { userId: req.user.sub, role: req.user.role };
checkPermission.assertCan(permCtx, 'job:create');
```
