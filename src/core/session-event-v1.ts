import { randomUUID } from 'node:crypto';
import type { SessionEvent } from './events.js';

export const SESSION_EVENT_SCHEMA_VERSION = 1 as const;
export interface SessionEventV1 {
  readonly eventId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly schemaVersion: 1;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export function createSessionEvent(sessionId: string, sequence: number, event: SessionEvent): SessionEventV1 {
  return { eventId: randomUUID(), sessionId, sequence, timestamp: new Date().toISOString(), schemaVersion: 1, type: mapType(event), data: event as unknown as Record<string, unknown> };
}

function mapType(event: SessionEvent): string {
  return event.type === 'user' ? 'message/user' : event.type === 'assistant' ? 'message/assistant' : event.type === 'tool_call' ? 'tool/call' : 'tool/result';
}

export function isSessionEventV1(value: unknown): value is SessionEventV1 {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.eventId === 'string' && typeof item.sessionId === 'string' && Number.isInteger(item.sequence) && (item.sequence as number) > 0
    && typeof item.timestamp === 'string' && item.schemaVersion === 1 && typeof item.type === 'string' && Boolean(item.data) && typeof item.data === 'object';
}
