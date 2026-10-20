import { parseResourceContentResultV1, parseResourceParseResultV1, parseResourceTitleResultV1, parseStructuredInferenceRequestV1, type ResourceModelSnapshotV1, type StructuredInferenceRequestV1, type StructuredInferenceSuccessV1 } from "./contracts.js";

export interface ResourceInferenceClientOptions {
  readonly endpoint: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class ResourceInferenceClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: ResourceInferenceClientOptions) { this.fetchImpl = options.fetchImpl ?? fetch; }

  async run(request: StructuredInferenceRequestV1, signal?: AbortSignal): Promise<StructuredInferenceSuccessV1<unknown>> {
    parseStructuredInferenceRequestV1(request);
    const controller = new AbortController();
    const timer = this.options.timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), this.options.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.fetchImpl(`${this.options.endpoint}/api/v1/inference/structured`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`);
      let value: unknown;
      try { value = await response.json(); } catch { throw new Error("HOST_RESPONSE_INVALID"); }
      const result = parseSuccess(value);
      validateInferenceOutput(request, result.output);
      return result;
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw new Error("HOST_REQUEST_CANCELLED");
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function parseSuccess(value: unknown): StructuredInferenceSuccessV1<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HOST_RESPONSE_INVALID");
  const item = value as Record<string, unknown>;
  if (typeof item.requestId !== "string" || item.status !== "succeeded" || !item.model || typeof item.model !== "object") throw new Error("HOST_RESPONSE_INVALID");
  const model = item.model as Record<string, unknown>;
  if (model.role !== "resource-worker" || typeof model.provider !== "string" || typeof model.model !== "string" || typeof model.profile !== "string" || typeof model.configRevision !== "string") throw new Error("HOST_RESPONSE_INVALID");
  if (item.schema === undefined) { /* schema is carried by the request, output validation happens below */ }
  if (item.output === undefined) throw new Error("HOST_RESPONSE_INVALID");
  return { requestId: item.requestId, status: "succeeded", output: item.output, model: model as unknown as ResourceModelSnapshotV1, ...(item.usage && typeof item.usage === "object" ? { usage: item.usage as never } : {}) };
}

export function validateInferenceOutput(request: StructuredInferenceRequestV1, output: unknown): void {
  if (request.schema === "resource.parse-result.v1") parseResourceParseResultV1(output);
  else if (request.schema === "resource.content-result.v1") parseResourceContentResultV1(output);
  else parseResourceTitleResultV1(output);
}
