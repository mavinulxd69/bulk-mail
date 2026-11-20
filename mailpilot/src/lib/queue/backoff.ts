/** Seconds to wait before retry number `failedAttempts` (1 = first retry). Exponential x4, capped at 6 h, with +-25 % jitter so a burst of failures doesn't retry in lockstep. */
export function retryDelaySeconds(failedAttempts: number, baseSeconds: number, rand: () => number = Math.random): number {
  const exp = baseSeconds * 4 ** Math.max(0, failedAttempts - 1);
  return Math.max(1, Math.round(Math.min(exp, 6 * 3600) * (0.75 + rand() * 0.5)));
}
