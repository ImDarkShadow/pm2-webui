export type Result<T, E = AppError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({
  ok: true,
  value,
});

export const err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

export const isOk = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } => result.ok;

export const isErr = <T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } => !result.ok;

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'TIMEOUT'
  | 'PM2_ERROR'
  | 'CRYPTO_ERROR'
  | 'NETWORK_ERROR';

export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown> | undefined;
  readonly cause?: unknown | undefined;
}

export const createAppError = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  cause?: unknown,
): AppError => ({
  code,
  message,
  ...(details ? { details } : {}),
  ...(cause ? { cause } : {}),
});
