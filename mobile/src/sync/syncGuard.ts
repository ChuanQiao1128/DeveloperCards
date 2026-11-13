// syncGuard — one module-level switch that turns every sync path off while an
// account is being deleted and after the delete succeeds (R25 G02).
//
// Deletion refreshes the access token before DELETE /api/v1/user/me, and handing
// a new token to the sync layer used to schedule a sync on the spot. Any sync
// that reached the server after the DELETE wrote rows back for a deleted user.
// So deletion blocks sync first, and every entry point (scheduleProgressSync,
// which forceProgressSync, the foreground handler, rating flushes and the outbox
// flush all go through, plus syncDrawStateNow) checks the block and does nothing.
//
// authStore blocks during startup until it has read the durable per-sub deletion
// intent. Once a deletion request may have reached the server, failures keep the
// block on; only a completed deletion followed by a new session, or another sub,
// can resume sync. Failure before any request may resume the unchanged account.
// No imports, so any module can read it without an import cycle.

let blocked = false;

export function blockSync(): void {
  blocked = true;
}

export function unblockSync(): void {
  blocked = false;
}

export function isSyncBlocked(): boolean {
  return blocked;
}
