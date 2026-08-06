/**
 * Matches jsonwebtoken's `expiresIn` string shape (e.g. "15m", "1h", "30d").
 * config/env.ts validates JWT_*_EXPIRES_IN against the same pattern at boot,
 * so this cast at the call site is honest, not a type-safety escape hatch.
 */
export type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'}`;

export function asDuration(value: string): Duration {
  return value as Duration;
}
