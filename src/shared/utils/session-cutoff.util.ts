/**
 * The instant from which older tokens stop being honoured, for a
 * `*SessionsInvalidatedAt` column.
 *
 * Truncated to whole seconds because a JWT's `iat` is whole seconds. The
 * guards reject a token when `iat * 1000 < cutoff`, so a cutoff carrying
 * milliseconds (a plain `new Date()`) is *later* than the `iat` of a token
 * minted in that same second — and the fresh session handed back by the very
 * request that moved the cutoff (a Vault recovery, a passcode change) was
 * rejected on its first use. With whole seconds, that token's
 * `iat * 1000 === cutoff` and passes, while anything issued in an earlier
 * second is still cut off.
 */
export function sessionCutoff(now: Date = new Date()): Date {
  return new Date(Math.floor(now.getTime() / 1000) * 1000);
}
