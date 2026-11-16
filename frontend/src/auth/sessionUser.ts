import { getSessionUser } from './tokenStore';
import type { SessionUser } from './tokenStore';

export type { SessionUser } from './tokenStore';

/** Share bearer permissions and subject consistency with AuthContext. */
export function readSessionUser(): SessionUser | null {
  return getSessionUser();
}

export function isSuperAdmin(user: SessionUser | null | undefined): boolean {
  return (user?.groups ?? []).includes('super_admin');
}
