/**
 * The signed-in user, made available to pages.
 *
 * `App` has always held the session in state and handed it to the nav and the
 * route guards, but never to the pages themselves. So a page that wants to know
 * whether this user may perform an action had two bad options: refetch `/me`,
 * or render the control and let the API reject it.
 *
 * `JobQueue` takes the second one today — it shows Reprint to a VIEWER, who
 * holds `job:read` but not `job:retry` (see ROLE_PERMISSIONS in
 * packages/domain/src/models/user.ts). The button works right up until the
 * server says no.
 *
 * Permission checks read from the same `ROLE_PERMISSIONS` table the API guards
 * with, so the client cannot drift into offering an action the server refuses.
 * This is presentation only: the server check is still the one that counts.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { ROLE_PERMISSIONS, type Permission } from '@printerops/domain';
import type { SessionUser } from './client.js';

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

/** The signed-in user, or `null` outside a provider (tests, storybook). */
export function useSessionUser(): SessionUser | null {
  return useContext(SessionContext);
}

/**
 * Whether the signed-in user holds `permission`.
 *
 * With no session in context this returns `false` — an unknown role is never
 * granted an action. A page that renders outside a provider shows the
 * read-only treatment, which is the safe direction to fail.
 */
export function useHasPermission(permission: Permission): boolean {
  const user = useSessionUser();
  if (!user) return false;
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}
