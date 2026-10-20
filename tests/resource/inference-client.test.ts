import { describe, expect, it } from "vitest";
import { ResourceInferenceClient } from "../../src/resource/inference-client.js";

const request = { requestId: "req-1", role: "resource-worker", task: "resource.suggest-title", schema: "resource.title-result.v1", input: { ruleTitleCandidates: ["demo"], downloadedNames: ["demo.zip"] } } as const;
const model = { role: "resource-worker", provider: "local", model: "3b", profile: "worker", configRevision: "1" } as const;

describe("ResourceInferenceClient", () => {
  it("sends authenticated structured inference and validates the response", async () => {
    let init: RequestInit | undefined;
    const client = new ResourceInferenceClient({ endpoint: "http://host", token: "secret-token", fetchImpl: async (_url, options) => { init = options; return new Response(JSON.stringify({ requestId: "req-1", status: "succeeded", output: { title: "Demo", alternatives: [], confidence: 0.8, needsReview: true, reviewReasons: ["worker"] }, model }), { status: 200, headers: { "content-type": "application/json" } }); } });
    await expect(client.run(request)).resolves.toMatchObject({ requestId: "req-1", status: "succeeded" });
    expect(init?.headers).toMatchObject({ authorization: "Bearer secret-token" });
  });

  it("maps HTTP failures and cancellation to stable errors", async () => {
    const failed = new ResourceInferenceClient({ endpoint: "http://host", token: "token", fetchImpl: async () => new Response("", { status: 503 }) });
    await expect(failed.run(request)).rejects.toThrow("HOST_HTTP_503");
    const controller = new AbortController();
    const cancelled = new ResourceInferenceClient({ endpoint: "http://host", token: "token", fetchImpl: async (_url, options) => await new Promise((_resolve, reject) => { options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }) });
    const pending = cancelled.run(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("HOST_REQUEST_CANCELLED");
  });
});
