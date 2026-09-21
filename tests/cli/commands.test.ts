import { describe, expect, it } from "vitest";
import { findCliCommand, listCliCommands } from "../../src/cli/commands.js";

describe("CLI command registry", () => {
  it("finds registered commands and ignores regular messages", () => {
    expect(findCliCommand("/exit")?.inputMode).toBe("line");
    expect(findCliCommand("/new")?.inputMode).toBe("line");
    expect(findCliCommand("/sessions")?.inputMode).toBe("raw");
    expect(findCliCommand("/memory")?.inputMode).toBe("raw");
    expect(findCliCommand("/help")?.inputMode).toBe("line");
    expect(findCliCommand("/models search qwen")?.inputMode).toBe("line");
    expect(findCliCommand("/mcp check local")?.inputMode).toBe("line");
    expect(findCliCommand("/mcp setup")?.inputMode).toBe("line");
    expect(findCliCommand("/skills")?.inputMode).toBe("line");
    expect(findCliCommand("/skill release-check")?.inputMode).toBe("line");
    expect(findCliCommand("你好")).toBeUndefined();
  });

  it("lists command names in display order", () => {
    expect(listCliCommands().map(command => command.name)).toEqual(["/new", "/sessions", "/task", "/skills", "/memory", "/trace", "/config", "/profile", "/models", "/mcp", "/help", "/exit"]);
  });
});
