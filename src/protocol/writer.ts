import type { Writable } from "node:stream";
import type { ProtocolEvent } from "./types.js";
export class ProtocolWriter {
  private pending = Promise.resolve();
  private failure: unknown;
  constructor(private readonly output: Writable) {}
  write(event: ProtocolEvent): void {
    this.pending = this.pending
      .then(() => this.writeOne(event))
      .catch(error => { this.failure ??= error; });
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.failure) throw this.failure;
  }

  private async writeOne(event: ProtocolEvent): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.output.write(`${JSON.stringify(event)}\n`, error => error ? reject(error) : resolve());
    });
  }
}
