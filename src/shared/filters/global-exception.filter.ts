import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import { ApiErrorResponse } from '../types/api-response';
import { ValidationIssue } from '../pipes/zod-validation.pipe';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_ERROR',
};

function codeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}

interface Resolved {
  status: number;
  code: string;
  message: string;
}

/**
 * Catches everything the app throws — NestJS HttpExceptions, ZodErrors, and
 * unknown errors — and formats it into `{ success: false, error }`.
 * This is the only place that shape gets constructed; controllers never
 * hand-roll error responses.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const resolved = this.resolve(exception);

    if (resolved.status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${resolved.status} ${resolved.code}: ${resolved.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      error: { code: resolved.code, message: resolved.message },
    };

    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): Resolved {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;

        if (Array.isArray(record.issues)) {
          const message = (record.issues as ValidationIssue[])
            .map((issue) =>
              issue.path ? `${issue.path}: ${issue.message}` : issue.message,
            )
            .join('; ');
          return {
            status,
            code:
              typeof record.code === 'string'
                ? record.code
                : codeForStatus(status),
            message,
          };
        }

        const rawMessage = record.message;
        const message = Array.isArray(rawMessage)
          ? rawMessage.join('; ')
          : typeof rawMessage === 'string'
            ? rawMessage
            : exception.message;

        return {
          status,
          code:
            typeof record.code === 'string'
              ? record.code
              : codeForStatus(status),
          message,
        };
      }

      return {
        status,
        code: codeForStatus(status),
        message: typeof payload === 'string' ? payload : exception.message,
      };
    }

    if (exception instanceof ZodError) {
      const message = exception.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }
}
