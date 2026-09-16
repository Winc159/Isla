import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { CliUserQuestionService } from "../src/user-questions/cli.js";

function interactiveInput() {
  return Object.assign(new PassThrough(), {
    isTTY: true as const,
    rawModes: [] as boolean[],
    setRawMode(enabled: boolean) { this.rawModes.push(enabled); },
  });
}

function capturedOutput() {
  let text = "";
  const stream = Object.assign(new Writable({ write(chunk, _encoding, callback) { text += chunk.toString(); callback(); } }), { isTTY: true, columns: 80 });
  return { stream, read: () => text };
}

describe("CliUserQuestionService", () => {
  it("renders options and maps a numeric answer to its label", async () => {
    const input = interactiveInput();
    const output = capturedOutput();
    const pending = new CliUserQuestionService(input, output.stream).ask({ questions: [{ id: "mode", header: "Mode", question: "Choose?", options: [{ label: "Safe", description: "Careful" }, { label: "Fast" }] }] });
    input.write("2\r");

    await expect(pending).resolves.toEqual({ answers: [{ id: "mode", selected: ["Fast"] }] });
    expect(output.read()).toContain("Mode: Choose?");
    expect(output.read()).toContain("1. Safe — Careful");
  });

  it("settles an active question when the turn is cancelled", async () => {
    const input = interactiveInput();
    const controller = new AbortController();
    const pending = new CliUserQuestionService(input, capturedOutput().stream).ask({ questions: [{ id: "name", question: "Name?" }] }, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "TURN_CANCELLED" });
    expect(input.rawModes).toEqual([true, false]);
  });
});
