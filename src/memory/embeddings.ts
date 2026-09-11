export interface EmbeddingProvider { readonly id: string; readonly model: string; embed(input: readonly string[]): Promise<readonly number[][]>; }

export function encodeEmbedding(vector: readonly number[], expectedDimensions?: number): Buffer {
  if (!vector.length) throw new Error("Embedding vector cannot be empty");
  if (expectedDimensions !== undefined && vector.length !== expectedDimensions) throw new Error("Embedding dimensions do not match generation");
  if (vector.some(value => !Number.isFinite(value))) throw new Error("Embedding vector contains a non-finite value");
  const result = Buffer.allocUnsafe(vector.length * 4); const view = new Float32Array(result.buffer, result.byteOffset, vector.length);
  vector.forEach((value, index) => { view[index] = value; }); return result;
}

export function decodeEmbedding(blob: Uint8Array, expectedDimensions?: number): number[] {
  if (!blob.byteLength || blob.byteLength % 4 !== 0) throw new Error("Invalid embedding blob");
  const view = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4); const result = [...view];
  if (expectedDimensions !== undefined && result.length !== expectedDimensions) throw new Error("Embedding dimensions do not match generation");
  if (result.some(value => !Number.isFinite(value))) throw new Error("Embedding vector contains a non-finite value"); return result;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (!left.length || left.length !== right.length) throw new Error("Embedding dimensions do not match");
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) { const a = left[index]!; const b = right[index]!; dot += a * b; leftNorm += a * a; rightNorm += b * b; }
  if (!Number.isFinite(dot) || leftNorm === 0 || rightNorm === 0) throw new Error("Zero embedding vector is not searchable");
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai-embeddings";
  constructor(readonly model: string, private readonly apiKey: string, private readonly baseURL = "https://api.openai.com/v1", private readonly timeoutMs = 60_000) {}
  async embed(input: readonly string[]): Promise<readonly number[][]> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try { const response = await fetch(`${this.baseURL.replace(/\/$/, "")}/embeddings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, input }), signal: controller.signal }); if (!response.ok) throw new Error(`Embedding request failed: ${response.status}`); const body = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }> }; const data = body.data?.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)); if (!data || data.length !== input.length || data.some(item => !item.embedding)) throw new Error("Embedding response is invalid"); return data.map(item => item.embedding!); }
    finally { clearTimeout(timeout); }
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-embeddings";
  constructor(readonly model: string, private readonly endpoint: string, private readonly timeoutMs = 60_000) {}
  async embed(input: readonly string[]): Promise<readonly number[][]> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try { const response = await fetch(this.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, input }), signal: controller.signal }); if (!response.ok) throw new Error(`Embedding request failed: ${response.status}`); const body = await response.json() as { embeddings?: number[][] }; if (!body.embeddings || body.embeddings.length !== input.length) throw new Error("Embedding response is invalid"); return body.embeddings; }
    finally { clearTimeout(timeout); }
  }
}
