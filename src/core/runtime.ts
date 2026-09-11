import { ChatSession } from "./session.js";
import type { PluginContext, RuntimePlugin } from "./plugin.js";
import type { Message, ModelProvider } from "./types.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { SessionEvent } from "./events.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import type { PermissionPreset } from "../approval/presets.js";
export interface CreateSessionOptions {
  readonly providerId: string;
  readonly systemPrompt?: string;
  readonly messages?: readonly Message[];
  readonly maxContextTurns?: number;
  readonly onMessagesChanged?: (messages: readonly Message[]) => Promise<void>;
  readonly onSessionEvent?: (event: SessionEvent) => Promise<void>;
  readonly projectRoot?: string;
  readonly onToolsUsed?: (tools: readonly string[]) => void;
  readonly onToolStarted?: (tool: string, callId: string) => void;
  readonly onToolFinished?: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly enableTools?: boolean;
  readonly approvalPolicy?: ApprovalPolicy;
  readonly approvalService?: ApprovalService;
  readonly permissionPreset?: PermissionPreset;
}
export class IslaRuntime {
  private readonly plugins = new Set<string>();
  private readonly providers = new Map<string, ModelProvider>();
  use(plugin: RuntimePlugin): this {
    if (this.plugins.has(plugin.name)) throw new Error(`Duplicate plugin name: ${plugin.name}`);
    const context: PluginContext = { registerProvider: provider => {
      if (this.providers.has(provider.id)) throw new Error(`Duplicate provider ID: ${provider.id}`);
      this.providers.set(provider.id, provider);
    }};
    plugin.setup(context); this.plugins.add(plugin.name); return this;
  }
  createSession(options: CreateSessionOptions): ChatSession {
    const provider = this.providers.get(options.providerId);
    if (!provider) throw new Error(`Provider not found: ${options.providerId}`);
    return new ChatSession(provider, options);
  }
}
