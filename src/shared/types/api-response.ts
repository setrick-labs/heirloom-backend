export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    /**
     * Structured, machine-readable specifics for errors a screen has to
     * render numerically rather than just display. Currently the Vault
     * unlock lockout (flow Screen 46 shows "2 attempts left" and "try again
     * in 1 minute"), which can't be reconstructed from a message string.
     *
     * Opt-in: a thrown exception only populates this if it includes a
     * `details` key, so ordinary errors keep the plain two-field shape.
     */
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Symbol-keyed marker so this envelope can never collide with real domain
 * data that happens to have its own `message` field (e.g. a Gift).
 */
const API_RESPONSE_MARKER = Symbol('ApiResponseEnvelope');

export interface ApiResponseEnvelope<T> {
  [API_RESPONSE_MARKER]: true;
  data?: T;
  message: string;
}

/**
 * Opt-in helper for controllers that want a custom success message.
 * Controllers that just `return someData` still get auto-wrapped by
 * ResponseInterceptor with a default message — this is only for when you
 * need to say something more specific than "OK".
 *
 *   return apiResponse(user, 'User created');
 *   return apiResponse('Invite sent'); // data-less
 */
export function apiResponse<T>(
  data: T,
  message: string,
): ApiResponseEnvelope<T>;
export function apiResponse(message: string): ApiResponseEnvelope<undefined>;
export function apiResponse<T>(
  dataOrMessage: T | string,
  message?: string,
): ApiResponseEnvelope<T | undefined> {
  if (message === undefined) {
    return { [API_RESPONSE_MARKER]: true, message: dataOrMessage as string };
  }
  return { [API_RESPONSE_MARKER]: true, data: dataOrMessage as T, message };
}

export function isApiResponseEnvelope(
  value: unknown,
): value is ApiResponseEnvelope<unknown> {
  return (
    typeof value === 'object' && value !== null && API_RESPONSE_MARKER in value
  );
}
