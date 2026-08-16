import { z } from 'zod';

import {
  idSchema,
  isoDateTimeSchema,
} from '../../../shared/validations/common.schema';

export const searchQuerySchema = z.object({
  familyId: idSchema,
  /**
   * Screen 41 re-runs the search live as the field is edited, so this is
   * hit on nearly every keystroke — capped short, and the service
   * short-circuits a blank/whitespace query without touching the database.
   */
  q: z.string().trim().min(1).max(100),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultKindSchema = z.enum([
  'journey',
  'milestone',
  'memory',
]);
export type SearchResultKind = z.infer<typeof searchResultKindSchema>;

/**
 * One flat, already-ranked list rather than three per-type arrays — Screen
 * 41 renders a single result list and only ever distinguishes types by the
 * `kind` label on a row.
 */
export const searchResultSchema = z.object({
  kind: searchResultKindSchema,
  id: idSchema,
  /** What matched, shown as the row's main line. */
  title: z.string(),
  /** Breadcrumb — "Summer in Portugal · Lisbon" — so a bare match has context. */
  subtitle: z.string().nullable(),
  /** Always present so any result can be navigated to, including a memory. */
  journeyId: idSchema,
  milestoneId: idSchema.nullable(),
  thumbnailUrl: z.url().nullable(),
  createdAt: isoDateTimeSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;
