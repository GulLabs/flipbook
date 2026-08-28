export class PageFlipError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PAGE_FLIP', options?: { cause?: unknown }) {
    super(message);
    this.name = 'PageFlipError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
