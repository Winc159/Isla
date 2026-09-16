import { ToolFailure } from "../tools/errors.js";
import type { UserQuestionRequest, UserQuestionResult, UserQuestionService } from "../user-questions/types.js";
import type { ProtocolRequest } from "./types.js";

export class ProtocolUserQuestionService implements UserQuestionService {
  private sequence = 0;
  private pending: { readonly questionId: string; readonly expectedIds: readonly string[]; readonly resolve: (result: UserQuestionResult) => void; readonly reject: (error: Error) => void } | undefined;
  private closed = false;

  constructor(private readonly emit: (questionId: string, request: UserQuestionRequest) => void) {}

  ask(request: UserQuestionRequest, options: { readonly signal?: AbortSignal } = {}): Promise<UserQuestionResult> {
    if (options.signal?.aborted) return Promise.reject(new ToolFailure("TURN_CANCELLED", "当前回合已取消。"));
    if (this.closed) return Promise.reject(new ToolFailure("TURN_CANCELLED", "协议输入已结束"));
    if (this.pending) return Promise.reject(new Error("A user question is already pending"));
    const questionId = `question-${++this.sequence}`;
    this.emit(questionId, request);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (this.pending?.questionId !== questionId) return;
        this.pending = undefined;
        reject(new ToolFailure("TURN_CANCELLED", "当前回合已取消。"));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending = {
        questionId,
        expectedIds: request.questions.map(question => question.id),
        resolve: result => { options.signal?.removeEventListener("abort", onAbort); resolve(result); },
        reject: error => { options.signal?.removeEventListener("abort", onAbort); reject(error); },
      };
      if (options.signal?.aborted) onAbort();
    });
  }

  resolve(response: Extract<ProtocolRequest, { type: "question_response" }>): boolean {
    if (!this.pending || this.pending.questionId !== response.questionId) return false;
    const answerIds = response.answers.map(answer => answer.id);
    if (answerIds.length !== this.pending.expectedIds.length || new Set(answerIds).size !== answerIds.length || this.pending.expectedIds.some(id => !answerIds.includes(id))) return false;
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve({ answers: response.answers });
    return true;
  }

  rejectPending(reason = "协议输入已结束"): void {
    this.closed = true;
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(new ToolFailure("TURN_CANCELLED", reason));
  }

  reopen(): void { this.closed = false; }
}
