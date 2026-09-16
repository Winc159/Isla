import { invalidArguments } from "./errors.js";
import type { Tool, ToolCapability } from "./types.js";
import type { UserQuestion, UserQuestionService } from "../user-questions/types.js";

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 10;

export function createUserInteractionCapability(service: UserQuestionService): ToolCapability {
  return {
    id: "user-interaction",
    instructions: "继续任务确实缺少用户确认、选择或信息时，调用 ask_user_question；它不同于权限批准，不要用它替代 Runtime Approval。",
    tools: [createAskUserQuestionTool(service)],
  };
}

export function createAskUserQuestionTool(service: UserQuestionService): Tool {
  return {
    definition: {
      name: "ask_user_question",
      description: "继续任务前需要确认、选择或缺失信息时，向用户提出一到三个简短问题并等待回答。",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description: "要询问的问题。",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "稳定问题 ID，回答中原样返回" },
                question: { type: "string", description: "具体问题" },
                header: { type: "string", description: "可选短标题" },
                options: {
                  type: "array",
                  description: "可选选项；推荐项放第一项并在标签后标记 (Recommended) 标记",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "简短选项标签" },
                      description: { type: "string", description: "选项影响或取舍" },
                    },
                    required: ["label"],
                    additionalProperties: false,
                  },
                },
                multi_select: { type: "boolean", description: "是否允许多选，默认 false" },
              },
              required: ["id", "question"],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
    },
    async execute(argumentsJson, options = {}) {
      const questions = parseQuestions(argumentsJson);
      const result = await service.ask({ questions }, options.signal ? { signal: options.signal } : {});
      return JSON.stringify({ answers: result.answers });
    },
  };
}

function parseQuestions(argumentsJson: string): readonly UserQuestion[] {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch { throw invalidArguments("ask_user_question arguments must be valid JSON"); }
  const questions = value && typeof value === "object" && !Array.isArray(value) ? (value as { questions?: unknown }).questions : undefined;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > MAX_QUESTIONS) throw invalidArguments(`ask_user_question questions must contain 1-${MAX_QUESTIONS} items`);
  const ids = new Set<string>();
  return questions.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidArguments(`ask_user_question questions[${index}] must be an object`);
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) throw invalidArguments(`ask_user_question questions[${index}].id must be non-empty and unique`);
    if (typeof item.question !== "string" || !item.question.trim()) throw invalidArguments(`ask_user_question questions[${index}].question must be non-empty`);
    if (item.header !== undefined && (typeof item.header !== "string" || !item.header.trim())) throw invalidArguments(`ask_user_question questions[${index}].header must be non-empty when provided`);
    if (item.multi_select !== undefined && typeof item.multi_select !== "boolean") throw invalidArguments(`ask_user_question questions[${index}].multi_select must be boolean`);
    ids.add(item.id);
    const options = parseOptions(item.options, index);
    return { id: item.id, question: item.question, ...(typeof item.header === "string" ? { header: item.header } : {}), ...(options ? { options } : {}), ...(typeof item.multi_select === "boolean" ? { multiSelect: item.multi_select } : {}) };
  });
}

function parseOptions(value: unknown, questionIndex: number): readonly { readonly label: string; readonly description?: string }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_OPTIONS) throw invalidArguments(`ask_user_question questions[${questionIndex}].options must contain 1-${MAX_OPTIONS} items`);
  return value.map((raw, optionIndex) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidArguments(`ask_user_question option ${optionIndex} must be an object`);
    const option = raw as Record<string, unknown>;
    if (typeof option.label !== "string" || !option.label.trim()) throw invalidArguments(`ask_user_question option ${optionIndex}.label must be non-empty`);
    if (option.description !== undefined && (typeof option.description !== "string" || !option.description.trim())) throw invalidArguments(`ask_user_question option ${optionIndex}.description must be non-empty when provided`);
    return { label: option.label, ...(typeof option.description === "string" ? { description: option.description } : {}) };
  });
}
