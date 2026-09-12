import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
describe("config", () => {
  it("reads cloud config", () => expect(readConfig({ ISLA_PROVIDER: "openai", ISLA_MODEL: "m", OPENAI_API_KEY: "test" })).toMatchObject({ provider: "openai", maxContextTurns: 20, maxContextChars: 60000, contextRetainTurns: 6, memoryEnabled: true }));
  it("reads local config without key", () => expect(readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "http://localhost:11434/v1" }).provider).toBe("local"));
  it("accepts an explicit session directory", () => expect(readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "http://localhost:11434/v1", ISLA_SESSION_DIR: "D:/tmp/isla" })).toMatchObject({ sessionDirectory: "D:/tmp/isla" }));
  it("validates optional embedding configuration", () => {
    expect(readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "http://localhost:11434/v1", ISLA_EMBEDDING_PROVIDER: "local", ISLA_EMBEDDING_MODEL: "embed", ISLA_EMBEDDING_BASE_URL: "http://localhost:1234/embed" })).toMatchObject({ embeddingProvider: "local", embeddingModel: "embed" });
    expect(() => readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "http://localhost:11434/v1", ISLA_EMBEDDING_PROVIDER: "local", ISLA_EMBEDDING_MODEL: "embed" })).toThrow();
  });
  it("accepts at most one explicit model retry", () => {
    expect(readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "http://localhost:11434/v1", ISLA_MODEL_RETRIES: "1" })).toMatchObject({ modelRetries: 1 });
    expect(() => readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "http://localhost:11434/v1", ISLA_MODEL_RETRIES: "2" })).toThrow("ISLA_MODEL_RETRIES");
  });
  it("rejects invalid values", () => { expect(() => readConfig({ ISLA_PROVIDER: "bad", ISLA_MODEL: "m" })).toThrow(); expect(() => readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "bad" })).toThrow(); expect(() => readConfig({ ISLA_PROVIDER: "openai", ISLA_MODEL: "m", OPENAI_API_KEY: "test", ISLA_MAX_CONTEXT_TURNS: "0" })).toThrow(); expect(() => readConfig({ ISLA_PROVIDER: "openai", ISLA_MODEL: "m", OPENAI_API_KEY: "test", ISLA_MAX_CONTEXT_CHARS: "0" })).toThrow(); expect(() => readConfig({ ISLA_PROVIDER: "openai", ISLA_MODEL: "m", OPENAI_API_KEY: "test", ISLA_CONTEXT_RETAIN_TURNS: "0" })).toThrow(); });
});
