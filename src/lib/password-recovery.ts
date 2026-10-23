// Only the SDK's recovery event establishes recovery intent. URL flags and
// ordinary signed-in sessions alone must never authorize this form.
let recoveryUserId: string | null = null;
const listeners = new Set<() => void>();

export function recordPasswordRecoveryEvent(event: string, userId?: string) {
  if (event === "PASSWORD_RECOVERY") recoveryUserId = userId ?? null;
  else if (event === "SIGNED_OUT" || event === "SIGNED_IN") recoveryUserId = null;
  else return;
  for (const listener of listeners) listener();
}

export function getRecoveryUserId() {
  return recoveryUserId;
}

export function subscribePasswordRecovery(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isVerifiedPasswordRecovery(expectedUserId: string | null, verifiedUserId?: string, error?: unknown) {
  return expectedUserId !== null && expectedUserId === verifiedUserId && !error;
}
