import type { Message } from "../core/types.js";

export interface PromptContext {
  readonly capabilities: readonly { id: string; instructions: string }[];
  readonly phase?: PromptPhase;
}

export type PromptPhase =
  | "legacy"
  | "intent"
  | "context"
  | "discussion"
  | "tool-loop"
  | "completion"
  | "final"
  | "summary";

export interface PromptSection {
  readonly id: string;
  readonly order: number;
  readonly phases?: readonly PromptPhase[];
  render(context: PromptContext): string | undefined;
}

export class PromptRegistry {
  private readonly sections = new Map<string, PromptSection>();

  register(section: PromptSection): void {
    if (this.sections.has(section.id)) throw new Error(`Duplicate prompt section: ${section.id}`);
    this.sections.set(section.id, section);
  }

  render(context: PromptContext): readonly string[] {
    return [...this.sections.values()]
      .filter(section => !section.phases || !context.phase || section.phases.includes(context.phase))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map(section => section.render(context))
      .filter((content): content is string => Boolean(content?.trim()));
  }

  compose(history: readonly Message[], context: PromptContext): Message[] {
    const existingSystem = history.filter(message => message.role === "system");
    const conversation = history.filter(message => message.role !== "system");
    const rendered = [...this.sections.values()]
      .filter(section => !section.phases || !context.phase || section.phases.includes(context.phase))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map(section => ({ order: section.order, content: section.render(context) }))
      .filter((section): section is { order: number; content: string } => Boolean(section.content?.trim()));
    const beforeHistory = rendered.filter(section => section.order < 0).map(section => ({ role: "system" as const, content: section.content }));
    const afterHistory = rendered.filter(section => section.order >= 0).map(section => ({ role: "system" as const, content: section.content }));
    return [
      ...beforeHistory,
      ...existingSystem,
      ...afterHistory,
      ...conversation,
    ];
  }
}
