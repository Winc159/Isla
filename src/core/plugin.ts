import type { ModelProvider } from "./types.js";
export interface PluginContext { registerProvider(provider: ModelProvider): void; }
export interface RuntimePlugin { readonly name: string; setup(context: PluginContext): void; }
