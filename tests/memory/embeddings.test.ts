import { describe, expect, it } from "vitest";
import { cosineSimilarity, decodeEmbedding, encodeEmbedding } from "../../src/memory/embeddings.js";

describe("embeddings", () => {
  it("round trips Float32 vectors and rejects invalid data", () => {
    expect(decodeEmbedding(encodeEmbedding([0.25, -1, 2]), 3)).toEqual([0.25, -1, 2]);
    expect(() => encodeEmbedding([], 0)).toThrow();
    expect(() => encodeEmbedding([Number.NaN])).toThrow();
    expect(() => encodeEmbedding([1, 2], 3)).toThrow();
  });
  it("calculates exact cosine similarity with explicit zero/dimension errors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow();
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow();
  });
});
