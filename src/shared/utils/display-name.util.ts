/**
 * One place that decides what a person is called, so a name resolved for a
 * comment author matches the one resolved for a family roster row.
 *
 * Three names can exist for the same person at once, and the flow's Family
 * screen (Screen 34) deliberately shows all three cases side by side:
 *
 *   "Priya (you)"   — no overrides, their own account name
 *   "Uncle Ant"     — the nickname THEY chose for this family (Screen 14)
 *   "Ahmed Mamu"    — the nickname YOU privately gave them (Screen 35)
 *
 * Precedence is viewer-first: your private alias wins over their own
 * nickname, which wins over their account name. That ordering is the whole
 * point of the feature — Screen 35's disclaimer ("This changes what YOU
 * call him. He'll still be 'Uncle Ant' to everyone else") is only true if
 * the alias is applied per-viewer at read time and never written back onto
 * the subject.
 */

/** Which source won — the client renders a different subtitle for each (Screen 34). */
export type NameSource = 'alias' | 'nickname' | 'name';

export interface ResolvedDisplayName {
  /** What this viewer should see everywhere: comments, headers, rosters. */
  resolvedName: string;
  /** The person's own account name (users.name), unresolved. */
  displayName: string;
  /** The nickname they chose for this family, or null if they never set one. */
  nickname: string | null;
  /** True when the viewer has privately renamed this person. */
  hasAlias: boolean;
  nameSource: NameSource;
}

export function resolveDisplayName(input: {
  /** users.name — always present, the final fallback. */
  displayName: string;
  /** family_members.nickname for the subject in this family. */
  nickname?: string | null;
  /** aliases.nickname set BY the viewer FOR this subject in this family. */
  alias?: string | null;
}): ResolvedDisplayName {
  const nickname = input.nickname ?? null;
  const alias = input.alias ?? null;

  if (alias) {
    return {
      resolvedName: alias,
      displayName: input.displayName,
      nickname,
      hasAlias: true,
      nameSource: 'alias',
    };
  }
  if (nickname) {
    return {
      resolvedName: nickname,
      displayName: input.displayName,
      nickname,
      hasAlias: false,
      nameSource: 'nickname',
    };
  }
  return {
    resolvedName: input.displayName,
    displayName: input.displayName,
    nickname: null,
    hasAlias: false,
    nameSource: 'name',
  };
}
