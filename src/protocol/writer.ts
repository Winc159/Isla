import type { Writable } from "node:stream";
import { once } from "node:events";
import type { ProtocolEvent } from "./types.js";
export class ProtocolWriter {
  private pending: Promise<void> | undefined;
  constructor(private readonly output: Writable) {}
  write(event: ProtocolEvent): Promise<void> {
    const operation = this.pending
      ? this.pending.then(() => this.writeOne(event))
      : this.writeOne(event);
    const settled = operation.then(() => undefined, () => undefined);
    this.pending = settled;
    settled.then(() => { if (this.pending === settled) this.pending = undefined; });
    return operation;
  }

  private async writeOne(event: ProtocolEvent): Promise<void> {
    const accepted = this.output.write(`${JSON.stringify(event)}\n`);
    if (!accepted) {
      await Promise.race([
        once(this.output, "drain"),
        once(this.output, "error").then(([error]) => { throw error; }),
      ]);
    }
  }
}
