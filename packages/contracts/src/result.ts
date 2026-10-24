/** Error codes shared by every host operation. Stable: the UI branches on them. */
export type StudioErrorCode =
  | "NO_WORKSPACE"
  | "INVALID_ARGUMENT"
  | "INVALID_PATH"
  | "INVALID_NAME"
  | "OUTSIDE_WORKSPACE"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "PERMISSION_DENIED"
  | "CONFLICT"
  | "BINARY_FILE"
  | "FILE_TOO_LARGE"
  | "CONFIRMATION_REQUIRED"
  | "TERMINAL_NOT_FOUND"
  | "TERMINAL_LIMIT"
  | "SHELL_UNAVAILABLE"
  | "NOT_CONNECTED"
  /** A credential was rejected (invalid, expired or revoked). */
  | "UNAUTHORIZED"
  /** The credential is valid but may not see that resource. */
  | "FORBIDDEN"
  /** The remote system could not be reached or failed; try again later. */
  | "UNAVAILABLE"
  | "UNTRUSTED_SENDER"
  | "UNKNOWN";

export interface StudioError {
  code: StudioErrorCode;
  /** A sentence that is safe and useful to show to the user. */
  message: string;
}

/**
 * Every operation crossing a process boundary returns a Result instead of
 * throwing, so errors keep their code and message intact.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: StudioError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: StudioErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}
