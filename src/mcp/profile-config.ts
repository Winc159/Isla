import type { ConfigStore } from '../config-store.js';
import { resolveProfile, type IslaConfigFileV1, type StartupProfileV1 } from '../config.js';
import type { McpServerConfig } from './types.js';

export interface McpConfigSummary {
  readonly id: string;
  readonly required: boolean;
  readonly commandConfigured: boolean;
  readonly argsCount: number;
  readonly cwdConfigured: boolean;
  readonly envKeys: readonly string[];
  readonly startupTimeoutMs: number;
  readonly callTimeoutMs: number;
}

export function summarizeMcpServer(server: McpServerConfig): McpConfigSummary {
  return { id: server.id, required: server.required, commandConfigured: Boolean(server.command), argsCount: server.args.length, cwdConfigured: server.cwd !== undefined, envKeys: Object.keys(server.env).sort(), startupTimeoutMs: server.startupTimeoutMs, callTimeoutMs: server.callTimeoutMs };
}

export function listMcpConfig(file: IslaConfigFileV1, profileName?: string): readonly McpConfigSummary[] {
  const { profile } = resolveProfile(file, profileName);
  return (profile.mcp?.servers ?? []).map(summarizeMcpServer);
}

export function replaceMcpServers(file: IslaConfigFileV1, profileName: string, servers: readonly McpServerConfig[]): IslaConfigFileV1 {
  const profile = file.profiles[profileName];
  if (!profile) throw new Error(`Isla profile not found: ${profileName}`);
  const nextProfile: StartupProfileV1 = { ...profile, mcp: { servers: [...servers] } };
  return { ...file, profiles: { ...file.profiles, [profileName]: nextProfile } };
}

export async function saveMcpServers(store: ConfigStore, profileName: string, servers: readonly McpServerConfig[]): Promise<void> {
  const loaded = await store.load();
  if (loaded.status !== 'ready') throw new Error(loaded.status === 'missing' ? 'Isla config does not exist' : loaded.status === 'empty' ? 'Isla config has no profiles' : loaded.message);
  const next = replaceMcpServers(loaded.config, profileName, servers);
  await store.save(next, loaded.revision);
}

