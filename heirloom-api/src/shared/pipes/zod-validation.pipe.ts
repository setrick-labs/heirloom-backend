import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Per-parameter validation: `@Body(new ZodValidationPipe(createUserInputSchema)) body: X`.
 * Bind it on the specific `@Body()`/`@Query()`/`@Param()` argument, not via
 * method-level `@UsePipes()` — that would run every other decorated
 * parameter (e.g. `@CurrentUser()`) through the same schema too.
 * On failure it throws a BadRequestException whose response body carries a
 * `code`/`issues` shape that GlobalExceptionFilter knows how to format into
 * the standard `{ success: false, error }` envelope.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues,
      });
    }

    return result.data;
  }
}
