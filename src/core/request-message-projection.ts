import { appendCheckpoint, buildContextProjection, type ContextCheckpoint } from "./context.js";
import type { Message } from "./types.js";

export interface RequestMessageProjectionOptions {
  readonly currentUserMessageIndex: number;
  readonly checkpoint: ContextCheckpoint | undefined;
  readonly maxTurns: number;
  readonly maxChars: number;
}

export function buildRequestMessageProjection(
  messages: readonly Message[],
  options: RequestMessageProjectionOptions,
): Message[] {
  const checkpointThrough = options.checkpoint?.throughMessageIndex ?? -1;
  const visibleMessages = messages.filter((message, index) =>
    (message.role === "system" || index > checkpointThrough)
    && (message.source?.kind !== "skill-invocation" || message.source.userMessageIndex === options.currentUserMessageIndex));
  const projection = buildContextProjection(visibleMessages, {
    maxTurns: options.maxTurns,
    maxChars: options.maxChars,
  });
  return appendCheckpoint(projection, options.checkpoint);
}
