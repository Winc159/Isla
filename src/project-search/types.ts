export const PROJECT_SEARCH_DEFAULTS = {
  maxFileBytes: 1_048_576,
  limit: 20,
  maxChars: 8_000,
  maxSourceChars: 4_096,
  contextLines: 1,
} as const;

export interface ProjectSearchQuery {
  readonly text: string;
  readonly path?: string;
  readonly limit?: number;
  readonly maxChars?: number;
  readonly contextLines?: number;
}

export interface ProjectSource {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly excerpt: string;
}

export interface ProjectSearchResult {
  readonly sources: readonly ProjectSource[];
  readonly filesScanned: number;
  readonly truncated: boolean;
}

export interface ProjectSearchService {
  search(query: ProjectSearchQuery): Promise<ProjectSearchResult>;
}

export type ProjectSearchValidationCode = "EMPTY_QUERY" | "INVALID_PATH" | "INVALID_LIMIT" | "INVALID_MAX_CHARS" | "INVALID_CONTEXT_LINES";

export class ProjectSearchValidationError extends Error {
  readonly code: ProjectSearchValidationCode;
  constructor(code: ProjectSearchValidationCode, message: string) {
    super(message);
    this.name = "ProjectSearchValidationError";
    this.code = code;
  }
}

export function validateProjectSearchQuery(query: ProjectSearchQuery): ProjectSearchQuery {
  if (!query.text.trim()) throw new ProjectSearchValidationError("EMPTY_QUERY", "project search query must not be empty");
  if (query.path !== undefined && (!query.path.trim() || query.path.includes("\0"))) throw new ProjectSearchValidationError("INVALID_PATH", "project search path must be a non-empty relative path");
  validatePositiveInteger(query.limit, "INVALID_LIMIT", "project search limit");
  validatePositiveInteger(query.maxChars, "INVALID_MAX_CHARS", "project search maxChars");
  validateNonNegativeInteger(query.contextLines, "INVALID_CONTEXT_LINES", "project search contextLines");
  return query;
}

function validatePositiveInteger(value: number | undefined, code: ProjectSearchValidationCode, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new ProjectSearchValidationError(code, `${label} must be a positive integer`);
}

function validateNonNegativeInteger(value: number | undefined, code: ProjectSearchValidationCode, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new ProjectSearchValidationError(code, `${label} must be a non-negative integer`);
}
