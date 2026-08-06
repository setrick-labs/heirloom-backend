import { z } from 'zod';

/** Shared primitives so every modules/<feature>/validations/*.schema.ts stays consistent. */

export const idSchema = z.uuid();

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
