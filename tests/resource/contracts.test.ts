import { describe, expect, it } from "vitest";
import { parseConfirmResourceJobRequestV1, parseCreateResourceJobRequestV1, parseResourceParseResultV1, parseStructuredInferenceRequestV1, RESOURCE_API_PREFIX, STRUCTURED_INFERENCE_ERROR_CODES } from "../../src/resource/contracts.js";
import { parseResourceConfig } from "../../src/resource/config.js";
import { RESOURCE_CASE_FIXTURES } from "../fixtures/resource-cases.js";

const config = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  version: 1,
  listen: { host: "127.0.0.1", port: 43120, allowedOrigins: ["http://127.0.0.1:43120"] },
  isla: { endpoint: "http://127.0.0.1:43110", token: "test-token-not-secret" },
  databasePath: "D:/fixture/resource.sqlite",
  stagingPath: "D:/fixture/staging",
  managedRoots: [{ id: "library", label: "Library", path: "D:/fixture/library", scanEnabled: true, outputEnabled: true }],
  defaultDestinationRootId: "library",
  ...overrides,
});

describe("Resource v1 contracts", () => {
  it("freezes the API prefix and stable inference errors", () => {
    expect(RESOURCE_API_PREFIX).toBe("/api/v1/resource");
    expect(STRUCTURED_INFERENCE_ERROR_CODES).toContain("TASK_SCHEMA_MISMATCH");
  });

  it("validates structured task and schema pairs", () => {
    expect(parseStructuredInferenceRequestV1({ requestId: "req-1", role: "resource-worker", task: "resource.parse-share-text", schema: "resource.parse-result.v1", input: {} }).requestId).toBe("req-1");
    expect(() => parseStructuredInferenceRequestV1({ requestId: "req-1", role: "resource-worker", task: "resource.parse-share-text", schema: "resource.title-result.v1", input: {} })).toThrow("TASK_SCHEMA_MISMATCH");
  });

  it("validates create and revision-controlled confirmation requests", () => {
    expect(parseCreateResourceJobRequestV1({ tool: "baidu-download", input: { kind: "share-text", text: "https://pan.baidu.com/s/fixture" }, destinationRootId: "library" }).startMode).toBeUndefined();
    expect(parseCreateResourceJobRequestV1({ tool: "baidu-download", input: { kind: "baidu-path", path: "/apps/bdpan/fixture.zip" }, destinationRootId: "library" }).input.kind).toBe("baidu-path");
    expect(() => parseCreateResourceJobRequestV1({ tool: "baidu-download", input: { kind: "baidu-path", path: "/apps/bdpan/../private" }, destinationRootId: "library" })).toThrow();
    expect(parseCreateResourceJobRequestV1({ tool: "archive-organizer", input: { kind: "managed-folder", managedRootId: "library", relativePath: "incoming" }, destinationRootId: "library" }).tool).toBe("archive-organizer");
    expect(parseConfirmResourceJobRequestV1({ decisionId: "decision-1", revision: 2, action: "approve" }).revision).toBe(2);
    expect(() => parseConfirmResourceJobRequestV1({ decisionId: "decision-1", revision: 0, action: "approve" })).toThrow("revision");
  });

  it("validates bounded parse results", () => {
    expect(parseResourceParseResultV1({ source: "baidu", shareUrl: "https://pan.baidu.com/s/fixture", archivePasswords: ["one", "two"], category: "archive", confidence: 0.8, needsReview: true, reviewReasons: ["multiple-passwords"] }).archivePasswords).toHaveLength(2);
    expect(() => parseResourceParseResultV1({ source: "baidu", shareUrl: "http://pan.baidu.com/s/fixture", archivePasswords: [], category: "unknown", confidence: 2, needsReview: false, reviewReasons: [] })).toThrow();
  });
});

describe("Resource config v1", () => {
  it("applies frozen pool and scanning defaults", () => expect(parseResourceConfig(config())).toMatchObject({ concurrency: { download: 2, inspection: 2, extraction: 1, inference: 2 }, scanning: { intervalMs: 30_000, settleMs: 10_000 } }));
  it("requires download concurrency of at least two", () => expect(() => parseResourceConfig(config({ concurrency: { download: 1 } }))).toThrow("concurrency.download"));
  it("requires a selectable output root", () => expect(() => parseResourceConfig(config({ managedRoots: [{ id: "inbox", label: "Inbox", path: "D:/fixture/inbox", scanEnabled: true, outputEnabled: false }], defaultDestinationRootId: "inbox" }))).toThrow("output-enabled"));
  it("does not include real credentials or private resources in fixtures", () => expect(config()).not.toMatch(/sk-|cookie|真实/u));
});

describe("Resource acceptance fixtures", () => {
  it("covers every frozen archive case with sanitized share data", () => {
    expect(new Set(RESOURCE_CASE_FIXTURES.map(item => item.expected.archiveCase))).toEqual(new Set(["ordinary", "renamed", "mp4-appended-rar", "multi-volume", "rar5"]));
    expect(RESOURCE_CASE_FIXTURES.some(item => item.expected.hasShareCode)).toBe(true);
    expect(RESOURCE_CASE_FIXTURES.some(item => item.expected.passwordCount > 1)).toBe(true);
    for (const fixture of RESOURCE_CASE_FIXTURES) expect(fixture.shareText).toContain("fixture");
  });
});
