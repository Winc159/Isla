import { describe, expect, it } from "vitest";
import { ResourceStructuredInferenceService } from "../../src/resource/inference.js";
import type { ModelProvider } from "../../src/core/types.js";

const model = { role: "resource-worker" as const, profile: "worker", provider: "fake", model: "fixture-worker", configRevision: "rev-1" };
const provider: ModelProvider = { id: "fake", model: "fixture-worker", generate: async request => ({ text: JSON.stringify({ source: "baidu", shareUrl: "https://pan.baidu.com/s/fixture", archivePasswords: ["demo"], category: "archive", confidence: 0.9, needsReview: false, reviewReasons: [] }), model: request.messages[1]?.content }) };

describe("Resource structured Worker", () => {
  it("uses a provider without tools, session history or file paths", async () => {
    let captured: Parameters<ModelProvider["generate"]>[0] | undefined;
    const service = new ResourceStructuredInferenceService({ provider: { ...provider, generate: async request => { captured = request; return provider.generate(request); } }, model });
    const result = await service.run({ requestId: "req-1", role: "resource-worker", task: "resource.parse-share-text", schema: "resource.parse-result.v1", input: { rawText: "fixture", ruleResult: { shareUrls: [], shareCodeCandidates: [], archivePasswordCandidates: [], titleCandidates: [] } } });
    expect(result.model).toEqual(model);
    expect(captured?.tools).toBeUndefined();
    expect(captured?.messages).toHaveLength(2);
    expect(captured?.messages.some(message => message.content.includes("C:\\") || message.content.includes("/home/") || message.content.includes("apiKey"))).toBe(false);
  });

  it("rejects invalid model JSON", async () => {
    const service = new ResourceStructuredInferenceService({ provider: { ...provider, generate: async () => ({ text: "not-json" }) }, model });
    await expect(service.run({ requestId: "req-2", role: "resource-worker", task: "resource.parse-share-text", schema: "resource.parse-result.v1", input: { rawText: "fixture", ruleResult: { shareUrls: [], shareCodeCandidates: [], archivePasswordCandidates: [], titleCandidates: [] } } })).rejects.toThrow("MODEL_RESPONSE_INVALID");
  });

  it("validates content and title result schemas", async () => {
    const service = new ResourceStructuredInferenceService({ provider: { ...provider, generate: async request => ({ text: request.messages[1]?.content.includes("identify-content") ? JSON.stringify({ category: "video", structure: "season", meaningfulDirectories: ["第一季"], wrapperDirectories: [], confidence: 0.8, needsReview: false, reviewReasons: [] }) : JSON.stringify({ title: "课程", alternatives: [], confidence: 0.7, needsReview: true, reviewReasons: ["confirm-name"] }) }) }, model });
    const content = await service.run({ requestId: "req-3", role: "resource-worker", task: "resource.identify-content", schema: "resource.content-result.v1", input: { entries: [{ relativePath: "第一季/EP01.mkv", kind: "file" }], ruleHints: { mediaExtensions: [".mkv"], meaningfulDirectories: ["第一季"], wrapperCandidates: [] } } });
    const title = await service.run({ requestId: "req-4", role: "resource-worker", task: "resource.suggest-title", schema: "resource.title-result.v1", input: { ruleTitleCandidates: [], downloadedNames: ["EP01.mkv"] } });
    expect(content.output).toMatchObject({ structure: "season" });
    expect(title.output).toMatchObject({ title: "课程" });
  });
});
