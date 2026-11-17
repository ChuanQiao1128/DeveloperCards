import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

export const RESEND_COOLDOWN_MS = 60_000;

/** Use wall time so a trip to Mail does not pause the resend countdown. */
export function useResendCooldown(sentAt?: number) {
  const [deadline, setDeadline] = useState(sentAt !== undefined ? sentAt + RESEND_COOLDOWN_MS : 0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    setDeadline(sentAt !== undefined ? sentAt + RESEND_COOLDOWN_MS : 0);
    setNow(Date.now());
  }, [sentAt]);

  const active = deadline > now;

  useEffect(() => {
    if (!active) return;
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 1000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') update();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [deadline, active]);

  const startCooldown = useCallback(() => {
    const sent = Date.now();
    setNow(sent);
    setDeadline(sent + RESEND_COOLDOWN_MS);
  }, []);

  return {
    cooldownSec: Math.max(0, Math.ceil((deadline - now) / 1000)),
    startCooldown,
  };
}
