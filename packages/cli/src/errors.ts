import { Pdf2PltError } from "@pdf2plt/core";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function normalizeCliError(error: unknown): Error {
  if (error instanceof CliUsageError || error instanceof Pdf2PltError) return error;
  return error instanceof Error ? error : new Error("发生未知错误。");
}
