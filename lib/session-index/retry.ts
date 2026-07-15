export function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function shouldRetryMissingFile(error: unknown, attemptsRemaining: number): boolean {
  return attemptsRemaining > 0 && isMissingFileError(error);
}
