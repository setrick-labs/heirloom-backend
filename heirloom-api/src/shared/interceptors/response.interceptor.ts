import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  ApiSuccessResponse,
  isApiResponseEnvelope,
} from '../types/api-response';

const DEFAULT_MESSAGE_BY_STATUS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
};

/**
 * Wraps every successful controller return into
 * `{ success: true, data, message }` so individual controllers never have
 * to hand-roll the envelope. A controller may still opt into a custom
 * message via the `apiResponse()` helper (see shared/types/api-response.ts).
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((result) => {
        if (isApiResponseEnvelope(result)) {
          return {
            success: true,
            data: result.data as T,
            message: result.message,
          };
        }

        return {
          success: true,
          data: result,
          message: DEFAULT_MESSAGE_BY_STATUS[response.statusCode] ?? 'OK',
        };
      }),
    );
  }
}
