import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import type { Database } from '../../database/connection';
import { DATABASE_CONNECTION } from '../../database/database.module';
import {
  journeyMembers,
  journeys,
  media,
  milestones,
} from '../../database/schema';
import { StorageService } from '../../shared/services/storage.service';
import { resolveStoredImageUrl } from '../../shared/utils/cover-url.util';
import { isActiveFamilyMember } from '../../shared/utils/family-membership.util';
import type { SearchQuery, SearchResult } from './validations/search.schema';

/** Keeps one runaway query from scanning a whole family's media. */
const PER_KIND_LIMIT = 25;

@Injectable()
export class SearchService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Searches journey titles, milestone titles/locations, and memory
   * captions within one family.
   *
   * Visibility is resolved ONCE, up front, into the set of journey ids this
   * viewer can actually see — and every result type is then constrained to
   * that set. Doing it this way rather than filtering results afterwards is
   * deliberate: search is the easiest place in the app to leak the
   * *existence* of a private journey (a caption match would name it), and a
   * post-filter is one forgotten branch away from doing exactly that.
   */
  async search(userId: string, query: SearchQuery): Promise<SearchResult[]> {
    if (!(await isActiveFamilyMember(this.db, userId, query.familyId))) {
      throw new ForbiddenException('You are not a member of this family');
    }

    const visibleJourneys = await this.visibleJourneys(userId, query.familyId);
    if (visibleJourneys.length === 0) {
      return [];
    }
    const journeyIds = visibleJourneys.map((j) => j.id);
    const journeyTitleById = new Map(
      visibleJourneys.map((j) => [j.id, j.title]),
    );

    // ilike with an escaped pattern — the term is user input arriving on
    // every keystroke, so `%` and `_` in it must match literally rather
    // than silently turning into wildcards.
    const pattern = `%${escapeLikePattern(query.q)}%`;

    const [journeyRows, milestoneRows, mediaRows] = await Promise.all([
      this.db
        .select({
          id: journeys.id,
          title: journeys.title,
          coverStorageKey: journeys.coverStorageKey,
          coverImageUrl: journeys.coverImageUrl,
          createdAt: journeys.createdAt,
        })
        .from(journeys)
        .where(
          and(inArray(journeys.id, journeyIds), ilike(journeys.title, pattern)),
        )
        .limit(PER_KIND_LIMIT),
      this.db
        .select({
          id: milestones.id,
          journeyId: milestones.journeyId,
          title: milestones.title,
          location: milestones.location,
          coverStorageKey: milestones.coverStorageKey,
          coverImageUrl: milestones.coverImageUrl,
          createdAt: milestones.createdAt,
        })
        .from(milestones)
        .where(
          and(
            inArray(milestones.journeyId, journeyIds),
            isNull(milestones.deletedAt),
            or(
              ilike(milestones.title, pattern),
              ilike(milestones.location, pattern),
            ),
          ),
        )
        .limit(PER_KIND_LIMIT),
      this.db
        .select({
          id: media.id,
          milestoneId: media.milestoneId,
          journeyId: milestones.journeyId,
          milestoneTitle: milestones.title,
          caption: media.caption,
          storageKey: media.storageKey,
          thumbnailStorageKey: media.thumbnailStorageKey,
          createdAt: media.createdAt,
        })
        .from(media)
        .innerJoin(milestones, eq(media.milestoneId, milestones.id))
        .where(
          and(
            inArray(milestones.journeyId, journeyIds),
            isNull(milestones.deletedAt),
            ilike(media.caption, pattern),
          ),
        )
        .limit(PER_KIND_LIMIT),
    ]);

    // Presigning is a local signature, not a round trip, so resolving every
    // row's image costs no extra queries — and a result list of coloured
    // placeholders is most of what makes search feel like a stub.
    const [journeyCovers, milestoneCovers, mediaThumbs] = await Promise.all([
      Promise.all(
        journeyRows.map((row) =>
          resolveStoredImageUrl(
            this.storageService,
            row.coverStorageKey,
            row.coverImageUrl,
          ),
        ),
      ),
      Promise.all(
        milestoneRows.map((row) =>
          resolveStoredImageUrl(
            this.storageService,
            row.coverStorageKey,
            row.coverImageUrl,
          ),
        ),
      ),
      Promise.all(
        mediaRows.map((row) =>
          this.storageService.generatePresignedDownloadUrl(
            // Falls back to the original when the thumbnail variant hasn't
            // been generated yet, as MediaService.toDto does.
            row.thumbnailStorageKey ?? row.storageKey,
          ),
        ),
      ),
    ]);

    const results: SearchResult[] = [
      ...journeyRows.map((row, index) => ({
        kind: 'journey' as const,
        id: row.id,
        title: row.title,
        subtitle: null,
        journeyId: row.id,
        milestoneId: null,
        thumbnailUrl: journeyCovers[index] ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      ...milestoneRows.map((row, index) => ({
        kind: 'milestone' as const,
        id: row.id,
        title: row.title,
        subtitle: journeyTitleById.get(row.journeyId) ?? null,
        journeyId: row.journeyId,
        milestoneId: row.id,
        thumbnailUrl: milestoneCovers[index] ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      ...mediaRows.map((row, index) => ({
        kind: 'memory' as const,
        id: row.id,
        title: row.caption ?? 'Untitled memory',
        subtitle: [journeyTitleById.get(row.journeyId), row.milestoneTitle]
          .filter(Boolean)
          .join(' · '),
        journeyId: row.journeyId,
        milestoneId: row.milestoneId,
        thumbnailUrl: mediaThumbs[index] ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    ];

    return results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * The same three-way rule canAccessJourney enforces per-journey (owner,
   * 'all' visibility, or an explicit journey_members row), resolved in bulk
   * so search doesn't run an access check per candidate row.
   *
   * Gift-granted access is deliberately NOT included: a gifted journey is a
   * one-off reveal the recipient reaches from the gift itself, not
   * something that should start surfacing in their family search results.
   */
  private async visibleJourneys(userId: string, familyId: string) {
    const rows = await this.db
      .select({
        id: journeys.id,
        title: journeys.title,
        visibilityType: journeys.visibilityType,
        createdBy: journeys.createdBy,
      })
      .from(journeys)
      .where(and(eq(journeys.familyId, familyId), isNull(journeys.deletedAt)));

    const selectedIds = rows
      .filter((row) => row.visibilityType === 'selected')
      .map((row) => row.id);
    const myMemberships = selectedIds.length
      ? await this.db.query.journeyMembers.findMany({
          where: and(
            inArray(journeyMembers.journeyId, selectedIds),
            eq(journeyMembers.userId, userId),
          ),
        })
      : [];
    const myJourneyIds = new Set(myMemberships.map((m) => m.journeyId));

    return rows.filter(
      (row) =>
        row.createdBy === userId ||
        row.visibilityType === 'all' ||
        myJourneyIds.has(row.id),
    );
  }
}

/** Escapes LIKE metacharacters so a literal `%` or `_` in a query doesn't act as a wildcard. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
