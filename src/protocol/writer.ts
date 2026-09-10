import type { Writable } from "node:stream";
import type { ProtocolEvent } from "./types.js";
export class ProtocolWriter {
  constructor(private readonly output: Writable) {}
  write(event: ProtocolEvent): void { this.output.write(`${JSON.stringify(event)}\n`); }
}
