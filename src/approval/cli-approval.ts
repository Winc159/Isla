import type { Readable, Writable } from "node:stream";
import type { ApprovalRequest, ApprovalService } from "./types.js";

export class CliApprovalService implements ApprovalService {
  private readonly approved = new Set<string>();
  constructor(private readonly input: Readable, private readonly output: Writable) {}

  request(request: ApprovalRequest): Promise<{ approved: true } | { approved: false; reason?: string }> {
    const approvalKey = `${request.toolName}:${request.permission.kind}`;
    if (this.approved.has(approvalKey)) return Promise.resolve({ approved: true });
    this.output.write(`\nIsla 请求执行：\n工具：${request.toolName}\n操作：${request.summary}\n权限：${request.permission.kind}\n[y] 本次批准  [n/Esc] 拒绝  [a] 以后此工具都批准 `);
    return new Promise(resolve => {
      const input = this.input as Readable & { isTTY?: boolean; setRawMode?: (value: boolean) => void };
      input.setRawMode?.(true);
      input.resume();
      const finish = (decision: { approved: true } | { approved: false; reason?: string }) => {
        input.removeListener("data", onData);
        input.setRawMode?.(false);
        input.pause();
        this.output.write("\n");
        resolve(decision);
      };
      const onData = (chunk: Buffer | string) => {
        const value = chunk.toString().toLowerCase();
        if (value === "y") finish({ approved: true });
        else if (value === "a") { this.approved.add(approvalKey); finish({ approved: true }); }
        else if (value === "n" || value === "\u001b" || value === "\r" || value === "\n") finish({ approved: false, reason: "用户拒绝了工具调用" });
      };
      input.on("data", onData);
    });
  }
}
