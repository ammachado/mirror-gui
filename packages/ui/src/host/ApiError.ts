/** The only error type MirrorGuiHost.request rejects with, whatever the transport. */
export class ApiError extends Error {
  /** HTTP status, or 0 when no response was received. */
  readonly status: number;
  /** Parsed response body, if any. */
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}
