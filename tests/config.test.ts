import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
describe("config", () => {
  it("reads cloud config", () => expect(readConfig({ ISLA_PROVIDER: "openai", ISLA_MODEL: "m", OPENAI_API_KEY: "test" })).toMatchObject({ provider: "openai", maxContextTurns: 20 }));
  it("reads local config without key", () => expect(readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "http://localhost:11434/v1" }).provider).toBe("local"));
  it("rejects invalid values", () => { expect(() => readConfig({ ISLA_PROVIDER: "bad", ISLA_MODEL: "m" })).toThrow(); expect(() => readConfig({ ISLA_PROVIDER: "local", ISLA_MODEL: "m", ISLA_BASE_URL: "bad" })).toThrow(); expect(() => readConfig({ ISLA_PROVIDER: "openai", ISLA_MODEL: "m", OPENAI_API_KEY: "test", ISLA_MAX_CONTEXT_TURNS: "0" })).toThrow(); });
});
