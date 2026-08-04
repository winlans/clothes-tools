export class Pdf2PltError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Pdf2PltError";
    this.code = code;
  }
}
