/**
 * Error that carries an HTTP status code.
 * Thrown from middlewares, controllers and services; converted to a JSON
 * response by error.middleware.ts.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, HttpError);
  }
}
