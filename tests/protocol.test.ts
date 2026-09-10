import { describe, expect, it } from "vitest";
import { Writable, Readable } from "node:stream";
import { parseProtocolRequest } from "../src/protocol/parser.js";
import { ProtocolWriter } from "../src/protocol/writer.js";
import { runProtocol } from "../src/protocol/runner.js";
import { ChatSession } from "../src/core/session.js";
import { FakeProvider } from "./support/fake-provider.js";

describe("NDJSON protocol", () => {
  it("parses valid requests and rejects invalid input", () => {
    expect(parseProtocolRequest('{"type":"prompt","id":"1","text":"你好"}')).toMatchObject({ type: "prompt" });
    expect(() => parseProtocolRequest("bad")).toThrow("INVALID_JSON");
    expect(() => parseProtocolRequest('{"type":"prompt","id":"1","text":""}')).toThrow("INVALID_REQUEST");
  });
  it("writes one JSON event per line", () => {
    let output = "";
    const writer = new ProtocolWriter(new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } }));
    writer.write({ type: "ready", provider: "fake", model: "fake-model" });
    expect(JSON.parse(output)).toEqual({ type: "ready", provider: "fake", model: "fake-model" });
  });
  it("runs a prompt and exits using only protocol events", async () => {
    let output = "";
    const out = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    await runProtocol(Readable.from(['{"type":"prompt","id":"p1","text":"你好"}\n{"type":"exit","id":"e1"}\n']), out, new ChatSession(new FakeProvider([{ text: "你好" }])), "fake", "fake-model");
    const events = output.trim().split("\n").map(line => JSON.parse(line) as { type: string });
    expect(events.map(event => event.type)).toEqual(["ready", "response_start", "response_delta", "response_end", "bye"]);
  });
});
