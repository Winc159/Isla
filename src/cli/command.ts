import type { Readable, Writable } from 'node:stream';
import type { SessionStore, StoredSession } from '../session-store.js';
import type { MemoryStore } from '../memory/store.js';
import type { MemoryRuntime } from '../memory/runtime.js';
import type { ConfigStore } from '../config-store.js';

export type InteractiveInput = Readable & {
  readonly isTTY: true;
  setRawMode(enabled: boolean): void;
};

export interface CliCommandContext {
  readonly input: Readable;
  readonly output: Writable;
  readonly providerId: string;
  readonly model: string;
  readonly systemPrompt: string | undefined;
  readonly sessionStore: SessionStore;
  readonly memoryStore?: MemoryStore;
  readonly memoryRuntime?: MemoryRuntime;
  readonly commandLine?: string;
  readonly currentSession: StoredSession;
  readonly availableCommands: readonly CliCommandInfo[];
  readonly configStore?: ConfigStore;
  readonly configPath?: string;
  readonly profileName?: string;
  readonly openConfig?: (path: string) => Promise<void>;
}

export type CliCommandResult =
  | { readonly type: 'continue' }
  | { readonly type: 'exit' }
  | {
      readonly type: 'switch-session';
      readonly session: StoredSession;
      readonly replayHistory: boolean;
    };

export interface CliCommandInfo {
  readonly name: string;
  readonly description: string;
  readonly usage?: string;
}

export interface CliCommand extends CliCommandInfo {
  readonly inputMode: 'line' | 'raw';
  execute(context: CliCommandContext): Promise<CliCommandResult>;
}

export function isInteractiveInput(input: Readable): input is InteractiveInput {
  const candidate = input as Readable & { isTTY?: boolean; setRawMode?: unknown };
  return candidate.isTTY === true && typeof candidate.setRawMode === 'function';
}
