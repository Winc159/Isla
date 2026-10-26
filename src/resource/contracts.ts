export const RESOURCE_API_PREFIX = "/api/v1/resource";
export const STRUCTURED_INFERENCE_PATH = "/api/v1/inference/structured";

export const RESOURCE_STAGES = [
  "created", "parsing_rules", "parsing_model", "preview", "queued_download",
  "transferring", "downloading", "settling", "inspecting", "grouping_volumes",
  "testing_archive", "extracting", "verifying", "publishing", "completed",
] as const;

export const RESOURCE_JOB_STATUSES = [
  "queued", "running", "waiting_user", "cancelling", "completed", "failed", "cancelled",
] as const;

export const RESOURCE_EVENT_TYPES = [
  "job.created", "job.stage_changed", "job.progress", "job.waiting_user", "job.resumed",
  "job.completed", "job.failed", "job.cancelled", "artifact.discovered", "artifact.verified",
  "job.recovered_stale", "resource.inspecting", "resource.archives_found",
  "resource.embedded_archives_found", "resource.directory_publishing",
  "resource.nested_extract_started", "resource.nested_extract_completed", "resource.nested_extract_failed",
  "resource.volume_group_detected", "resource.volume_group_extracted",
  "resource.recursive_archives_found", "resource.recursive_archive_extracted", "resource.recursive_archive_failed",
  "resource.published", "resource.intermediates_removed", "resource.organize_retry_started",
] as const;

export const STRUCTURED_INFERENCE_ERROR_CODES = [
  "ROLE_NOT_CONFIGURED", "PROFILE_UNAVAILABLE", "MODEL_UNAVAILABLE", "INFERENCE_BUSY",
  "INFERENCE_TIMEOUT", "INFERENCE_CANCELLED", "MODEL_RESPONSE_INVALID",
  "SCHEMA_VALIDATION_FAILED", "TASK_SCHEMA_MISMATCH", "REQUEST_TOO_LARGE",
] as const;

export type ResourceStageV1 = typeof RESOURCE_STAGES[number];
export type ResourceJobStatusV1 = typeof RESOURCE_JOB_STATUSES[number];
export type ResourceEventTypeV1 = typeof RESOURCE_EVENT_TYPES[number];
export type StructuredInferenceErrorCodeV1 = typeof STRUCTURED_INFERENCE_ERROR_CODES[number];

export interface ApiErrorV1 {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly requestId?: string;
    readonly details?: Record<string, unknown>;
  };
}

export interface StructuredInferenceRequestV1 {
  readonly requestId: string;
  readonly role: "resource-worker";
  readonly task: "resource.parse-share-text" | "resource.identify-content" | "resource.suggest-title";
  readonly schema: "resource.parse-result.v1" | "resource.content-result.v1" | "resource.title-result.v1";
  readonly input: Record<string, unknown>;
  readonly timeoutMs?: number;
}

export interface ResourceParseInputV1 {
  readonly rawText: string;
  readonly ruleResult: {
    readonly shareUrls: readonly string[];
    readonly shareCodeCandidates: readonly string[];
    readonly archivePasswordCandidates: readonly string[];
    readonly titleCandidates: readonly string[];
  };
}

export interface ResourceContentInputV1 {
  readonly entries: readonly {
    readonly relativePath: string;
    readonly kind: "file" | "directory";
    readonly sizeBytes?: number;
    readonly extension?: string;
  }[];
  readonly ruleHints: {
    readonly archiveType?: string;
    readonly mediaExtensions: readonly string[];
    readonly meaningfulDirectories: readonly string[];
    readonly wrapperCandidates: readonly string[];
  };
}

export interface ResourceParseResultV1 {
  readonly source: "baidu";
  readonly shareUrl: string;
  readonly shareCode?: string;
  readonly archivePasswords: readonly string[];
  readonly title?: string;
  readonly category: "video" | "audio" | "book" | "software" | "archive" | "unknown";
  readonly year?: number;
  readonly season?: number;
  readonly confidence: number;
  readonly needsReview: boolean;
  readonly reviewReasons: readonly string[];
}

export interface ResourceContentResultV1 {
  readonly category: "video" | "audio" | "book" | "software" | "archive" | "mixed" | "unknown";
  readonly structure: "single" | "series" | "season" | "collection" | "unknown";
  readonly meaningfulDirectories: readonly string[];
  readonly wrapperDirectories: readonly string[];
  readonly confidence: number;
  readonly needsReview: boolean;
  readonly reviewReasons: readonly string[];
}

export interface ResourceTitleInputV1 {
  readonly explicitTitle?: string;
  readonly ruleTitleCandidates: readonly string[];
  readonly downloadedNames: readonly string[];
  readonly contentSummary?: ResourceContentResultV1;
}

export interface ResourceTitleResultV1 {
  readonly title?: string;
  readonly alternatives: readonly string[];
  readonly confidence: number;
  readonly needsReview: boolean;
  readonly reviewReasons: readonly string[];
}

export interface StructuredInferenceSuccessV1<T> {
  readonly requestId: string;
  readonly status: "succeeded";
  readonly output: T;
  readonly model: ResourceModelSnapshotV1;
  readonly usage?: { readonly input?: number; readonly output?: number; readonly total?: number };
}

export interface CreateResourceJobRequestV1 {
  readonly tool: "baidu-download" | "archive-organizer";
  readonly input: { readonly kind: "share-text"; readonly text: string } | { readonly kind: "baidu-path"; readonly path: string } | { readonly kind: "managed-folder" | "managed-file"; readonly managedRootId: string; readonly relativePath: string };
  readonly destinationRootId: string;
  readonly startMode?: "after-preview" | "automatic";
}

export interface ConfirmResourceJobRequestV1 {
  readonly decisionId: string;
  readonly revision: number;
  readonly action: "approve" | "reject" | "provide_values" | "replace_input" | "choose_destination";
  readonly values?: Record<string, unknown>;
}

export interface ResourceModelSnapshotV1 {
  readonly role: "resource-worker";
  readonly profile: string;
  readonly provider: string;
  readonly model: string;
  readonly configRevision: string;
}

export interface ResourceDecisionV1 {
  readonly id: string;
  readonly type: "confirm_parse_result" | "correct_share_input" | "provide_share_code" | "provide_archive_password" | "resolve_volume_group" | "choose_destination" | "resolve_name_conflict" | "handle_login" | "handle_captcha" | "handle_risk_control" | "approve_overwrite";
  readonly resumeStage: ResourceStageV1;
  readonly message: string;
  readonly actions: readonly ConfirmResourceJobRequestV1["action"][];
}

export interface ResourceJobSnapshotV1 {
  readonly version: 1;
  readonly id: string;
  readonly revision: number;
  readonly source: "baidu" | "managed-folder";
  readonly status: ResourceJobStatusV1;
  readonly stage: ResourceStageV1;
  readonly destinationRootId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly progress: { readonly ratio?: number; readonly completedBytes?: number; readonly totalBytes?: number; readonly currentItem?: string };
  readonly parseResult?: Record<string, unknown>;
  readonly modelSnapshot?: ResourceModelSnapshotV1;
  readonly pendingDecision?: ResourceDecisionV1;
  readonly failure?: { readonly code: string; readonly message: string; readonly retryable: boolean; readonly resumeStage?: ResourceStageV1 };
}

export interface ResourceEventV1 {
  readonly version: 1;
  readonly id: string;
  readonly jobId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: ResourceEventTypeV1;
  readonly data: Record<string, unknown>;
}

export function parseStructuredInferenceRequestV1(value: unknown): StructuredInferenceRequestV1 {
  const item = record(value, "structured inference request");
  nonEmptyString(item.requestId, "requestId");
  if (item.role !== "resource-worker") throw new Error("role must be resource-worker");
  const task = enumValue(item.task, ["resource.parse-share-text", "resource.identify-content", "resource.suggest-title"] as const, "task");
  const schema = enumValue(item.schema, ["resource.parse-result.v1", "resource.content-result.v1", "resource.title-result.v1"] as const, "schema");
  const expectedSchema = { "resource.parse-share-text": "resource.parse-result.v1", "resource.identify-content": "resource.content-result.v1", "resource.suggest-title": "resource.title-result.v1" }[task];
  if (schema !== expectedSchema) throw new Error("TASK_SCHEMA_MISMATCH");
  if (task === "resource.parse-share-text") parseResourceParseInputV1(item.input);
  else if (task === "resource.identify-content") parseResourceContentInputV1(item.input);
  else parseResourceTitleInputV1(item.input);
  if (item.timeoutMs !== undefined) integer(item.timeoutMs, "timeoutMs", 1, 120_000);
  return item as unknown as StructuredInferenceRequestV1;
}

export function parseCreateResourceJobRequestV1(value: unknown): CreateResourceJobRequestV1 {
  const item = record(value, "create resource job request");
  const tool = enumValue(item.tool, ["baidu-download", "archive-organizer"] as const, "tool");
  const input = record(item.input, "input");
  if (tool === "baidu-download") { if (input.kind === "share-text") nonEmptyString(input.text, "input.text", 20_000); else if (input.kind === "baidu-path") { const path = nonEmptyString(input.path, "input.path", 4_096); if (!path.startsWith("/") || path.includes("..")) throw new Error("input.path must be a safe remote path"); } else throw new Error("input.kind must be share-text or baidu-path"); }
  else { if (input.kind !== "managed-folder" && input.kind !== "managed-file") throw new Error("input.kind must be managed-folder or managed-file"); nonEmptyString(input.managedRootId, "input.managedRootId", 128); const relativePath = nonEmptyString(input.relativePath, "input.relativePath", 4_096); if (relativePath.includes("..") || /^[\\/]/u.test(relativePath)) throw new Error("input.relativePath must stay inside managed root"); }
  nonEmptyString(item.destinationRootId, "destinationRootId", 128);
  if (item.startMode !== undefined) enumValue(item.startMode, ["after-preview", "automatic"] as const, "startMode");
  return item as unknown as CreateResourceJobRequestV1;
}

export function parseConfirmResourceJobRequestV1(value: unknown): ConfirmResourceJobRequestV1 {
  const item = record(value, "confirm resource job request");
  nonEmptyString(item.decisionId, "decisionId", 128);
  integer(item.revision, "revision", 1, Number.MAX_SAFE_INTEGER);
  enumValue(item.action, ["approve", "reject", "provide_values", "replace_input", "choose_destination"] as const, "action");
  if (item.values !== undefined) record(item.values, "values");
  return item as unknown as ConfirmResourceJobRequestV1;
}

export function parseResourceParseResultV1(value: unknown): ResourceParseResultV1 {
  const item = record(value, "resource parse result");
  if (item.source !== "baidu") throw new Error("source must be baidu");
  const shareUrl = nonEmptyString(item.shareUrl, "shareUrl", 2_048);
  const url = new URL(shareUrl);
  if (url.protocol !== "https:") throw new Error("shareUrl must use HTTPS");
  optionalString(item.shareCode, "shareCode", 128);
  stringArray(item.archivePasswords, "archivePasswords", 32, 256);
  optionalString(item.title, "title", 256);
  enumValue(item.category, ["video", "audio", "book", "software", "archive", "unknown"] as const, "category");
  if (item.year !== undefined) integer(item.year, "year", 1900, 3000);
  if (item.season !== undefined) integer(item.season, "season", 0, 999);
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) throw new Error("confidence must be between 0 and 1");
  if (typeof item.needsReview !== "boolean") throw new Error("needsReview must be boolean");
  stringArray(item.reviewReasons, "reviewReasons", 32, 256);
  return item as unknown as ResourceParseResultV1;
}

export function parseResourceParseInputV1(value: unknown): ResourceParseInputV1 {
  const item = record(value, "parse input");
  nonEmptyString(item.rawText, "rawText", 20_000);
  const ruleResult = record(item.ruleResult, "ruleResult");
  stringArray(ruleResult.shareUrls, "ruleResult.shareUrls", 32, 2_048);
  stringArray(ruleResult.shareCodeCandidates, "ruleResult.shareCodeCandidates", 32, 128);
  stringArray(ruleResult.archivePasswordCandidates, "ruleResult.archivePasswordCandidates", 32, 256);
  stringArray(ruleResult.titleCandidates, "ruleResult.titleCandidates", 32, 256);
  return item as unknown as ResourceParseInputV1;
}

export function parseResourceContentInputV1(value: unknown): ResourceContentInputV1 {
  const item = record(value, "content input");
  if (!Array.isArray(item.entries) || item.entries.length > 20_000) throw new Error("entries must be a bounded array");
  for (const [index, value] of item.entries.entries()) {
    const entry = record(value, `entries[${index}]`);
    const path = nonEmptyString(entry.relativePath, `entries[${index}].relativePath`, 4_096);
    if (path.includes("..") || /^[\\/]/u.test(path)) throw new Error(`entries[${index}].relativePath must be relative`);
    enumValue(entry.kind, ["file", "directory"] as const, `entries[${index}].kind`);
    if (entry.sizeBytes !== undefined) integer(entry.sizeBytes, `entries[${index}].sizeBytes`, 0, Number.MAX_SAFE_INTEGER);
    if (entry.extension !== undefined) nonEmptyString(entry.extension, `entries[${index}].extension`, 64);
  }
  const hints = record(item.ruleHints, "ruleHints");
  if (hints.archiveType !== undefined) nonEmptyString(hints.archiveType, "ruleHints.archiveType", 64);
  stringArray(hints.mediaExtensions, "ruleHints.mediaExtensions", 128, 64);
  stringArray(hints.meaningfulDirectories, "ruleHints.meaningfulDirectories", 256, 4_096);
  stringArray(hints.wrapperCandidates, "ruleHints.wrapperCandidates", 256, 4_096);
  return item as unknown as ResourceContentInputV1;
}

export function parseResourceContentResultV1(value: unknown): ResourceContentResultV1 {
  const item = record(value, "content result");
  enumValue(item.category, ["video", "audio", "book", "software", "archive", "mixed", "unknown"] as const, "category");
  enumValue(item.structure, ["single", "series", "season", "collection", "unknown"] as const, "structure");
  stringArray(item.meaningfulDirectories, "meaningfulDirectories", 256, 4_096);
  stringArray(item.wrapperDirectories, "wrapperDirectories", 256, 4_096);
  confidence(item.confidence);
  boolean(item.needsReview, "needsReview");
  stringArray(item.reviewReasons, "reviewReasons", 32, 256);
  return item as unknown as ResourceContentResultV1;
}

export function parseResourceTitleInputV1(value: unknown): ResourceTitleInputV1 {
  const item = record(value, "title input");
  if (item.explicitTitle !== undefined) nonEmptyString(item.explicitTitle, "explicitTitle", 256);
  stringArray(item.ruleTitleCandidates, "ruleTitleCandidates", 32, 256);
  stringArray(item.downloadedNames, "downloadedNames", 256, 4_096);
  for (const [index, name] of (item.downloadedNames as readonly unknown[]).entries()) validateRelativePath(name, `downloadedNames[${index}]`);
  if (item.contentSummary !== undefined) parseResourceContentResultV1(item.contentSummary);
  return item as unknown as ResourceTitleInputV1;
}

export function parseResourceTitleResultV1(value: unknown): ResourceTitleResultV1 {
  const item = record(value, "title result");
  if (item.title !== undefined) nonEmptyString(item.title, "title", 256);
  stringArray(item.alternatives, "alternatives", 8, 256);
  confidence(item.confidence);
  boolean(item.needsReview, "needsReview");
  stringArray(item.reviewReasons, "reviewReasons", 32, 256);
  return item as unknown as ResourceTitleResultV1;
}

function confidence(value: unknown): void { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("confidence must be between 0 and 1"); }
function validateRelativePath(value: unknown, name: string): void { const path = nonEmptyString(value, name, 4_096); if (path.includes("..") || /^[\\/]/u.test(path) || /^[A-Za-z]:[\\/]/u.test(path)) throw new Error(`${name} must be relative`); }
function boolean(value: unknown, name: string): void { if (typeof value !== "boolean") throw new Error(`${name} must be boolean`); }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string, maxLength = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(`${name} must be a non-empty string up to ${maxLength} characters`);
  return value;
}

function optionalString(value: unknown, name: string, maxLength: number): void {
  if (value !== undefined) nonEmptyString(value, name, maxLength);
}

function stringArray(value: unknown, name: string, maxItems: number, maxLength: number): void {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== "string" || item.length > maxLength)) throw new Error(`${name} must be a bounded string array`);
}

function integer(value: unknown, name: string, min: number, max: number): void {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, name: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${name} is invalid`);
  return value as T[number];
}
