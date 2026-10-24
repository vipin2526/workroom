export interface HttpErrorOptions {
  retryAfterSeconds?: number;
}

export class HttpError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
