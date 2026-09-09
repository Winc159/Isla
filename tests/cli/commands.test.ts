import { describe, expect, it } from "vitest";
import { findCliCommand, listCliCommandNames } from "../../src/cli/commands.js";

describe("CLI command registry", () => {
  it("finds registered commands and ignores regular messages", () => {
    expect(findCliCommand("/exit")?.inputMode).toBe("line");
    expect(findCliCommand("/new")?.inputMode).toBe("line");
    expect(findCliCommand("/sessions")?.inputMode).toBe("raw");
    expect(findCliCommand("你好")).toBeUndefined();
  });

  it("lists command names in display order", () => {
    expect(listCliCommandNames()).toEqual(["/new", "/sessions", "/exit"]);
  });
});
