import type { Readable, Writable } from "node:stream";
import type { InteractiveInput } from "../cli/command.js";
import { readInteractiveMessage } from "../cli/input-editor.js";
import { ToolFailure } from "../tools/errors.js";
import type { UserQuestion, UserQuestionAnswer, UserQuestionRequest, UserQuestionResult, UserQuestionService } from "./types.js";

export class CliUserQuestionService implements UserQuestionService {
  constructor(private readonly input: Readable, private readonly output: Writable, private readonly onQuestion?: () => void) {}

  async ask(request: UserQuestionRequest, options: { readonly signal?: AbortSignal } = {}): Promise<UserQuestionResult> {
    this.onQuestion?.();
    const answers: UserQuestionAnswer[] = [];
    for (const question of request.questions) {
      if (options.signal?.aborted) throw new ToolFailure("TURN_CANCELLED", "当前回合已取消。");
      this.output.write(renderQuestion(question));
      const answer = await readInteractiveMessage(this.input as InteractiveInput, this.output, [], "", [], options.signal);
      if (answer.type === "exit" || options.signal?.aborted) throw new ToolFailure("TURN_CANCELLED", "当前回合已取消。");
      answers.push(parseAnswer(question, answer.value));
    }
    return { answers };
  }
}

function renderQuestion(question: UserQuestion): string {
  const lines = ["", question.header ? `${question.header}: ${question.question}` : question.question];
  question.options?.forEach((option, index) => lines.push(`${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`));
  lines.push(question.options?.length ? (question.multiSelect ? "请输入选项编号（逗号分隔）或自定义回答：" : "请输入选项编号或自定义回答：") : "请输入回答：");
  return `${lines.join("\n")}\n`;
}

function parseAnswer(question: UserQuestion, value: string): UserQuestionAnswer {
  const indexes = question.options?.length ? value.split(/[,，]/u).map(item => Number(item.trim()) - 1) : [];
  const validIndexes = indexes.filter(index => Number.isInteger(index) && index >= 0 && index < (question.options?.length ?? 0));
  const selected = [...new Set(validIndexes.map(index => question.options![index]!.label))];
  if (!question.multiSelect && selected.length > 1) selected.splice(1);
  return selected.length ? { id: question.id, selected } : { id: question.id, selected: [], custom: value };
}
