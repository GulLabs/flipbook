export class PageFlipError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PAGE_FLIP') {
    super(message);
    this.name = 'PageFlipError';
    this.code = code;
  }
}
