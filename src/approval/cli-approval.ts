import type { Readable, Writable } from "node:stream";
import type { ApprovalRequest, ApprovalRequestOptions, ApprovalService } from "./types.js";

export class CliApprovalService implements ApprovalService {
  private readonly approved = new Set<string>();
  constructor(private readonly input: Readable, private readonly output: Writable, private readonly onPromptStart?: () => void, private readonly onPromptEnd?: () => void) {}

  request(request: ApprovalRequest, options: ApprovalRequestOptions = {}): Promise<{ approved: true } | { approved: false; reason?: string }> {
    const approvalKey = `${request.toolName}:${request.permission.kind}`;
    if (options.signal?.aborted) return Promise.resolve({ approved: false, reason: "当前回合已取消。" });
    if (this.approved.has(approvalKey)) return Promise.resolve({ approved: true });
    this.onPromptStart?.();
    return new Promise(resolve => {
      const input = this.input as Readable & { isTTY?: boolean; setRawMode?: (value: boolean) => void };
      const previousDataListeners = input.rawListeners('data');
      const finish = (decision: { approved: true } | { approved: false; reason?: string }) => {
        input.removeListener("data", onData);
        for (const listener of previousDataListeners) input.on('data', listener as (...args: any[]) => void);
        options.signal?.removeEventListener("abort", onAbort);
        input.setRawMode?.(false);
        input.pause();
        this.output.write("\n");
        this.onPromptEnd?.();
        resolve(decision);
      };
      const decide = (value: string) => {
        value = value.toLowerCase();
        const decision = [...value].find(character => character === 'y' || character === 'a' || character === 'n' || character === '\u001b' || character === '\r' || character === '\n');
        if (decision === "y") finish({ approved: true });
        else if (decision === "a") { this.approved.add(approvalKey); finish({ approved: true }); }
        else if (decision === "n" || decision === "\u001b" || decision === "\r" || decision === "\n") finish({ approved: false, reason: "用户拒绝了工具调用" });
      };
      const onData = (chunk: Buffer | string) => decide(chunk.toString());
      const onAbort = () => finish({ approved: false, reason: "当前回合已取消。" });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      input.removeAllListeners('data');
      input.on("data", onData);
      input.setRawMode?.(true);
      input.resume();
      this.output.write(`\nIsla 请求执行：\n工具：${request.toolName}\n操作：${request.summary}\n权限：${request.permission.kind}\n[y] 本次批准  [n/Esc] 拒绝  [a] 以后此工具都批准 `);
    });
  }
}
