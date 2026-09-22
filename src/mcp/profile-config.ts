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
  readonly sensitiveEnvCount: number;
  readonly startupTimeoutMs: number;
  readonly callTimeoutMs: number;
}

export function isSensitiveMcpEnvKey(key: string): boolean {
  return /(KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH|CREDENTIAL)/i.test(key);
}

export function summarizeMcpServer(server: McpServerConfig): McpConfigSummary {
  const envKeys = Object.keys(server.env).sort();
  return { id: server.id, required: server.required, commandConfigured: Boolean(server.command), argsCount: server.args.length, cwdConfigured: server.cwd !== undefined, envKeys: envKeys.filter(key => !isSensitiveMcpEnvKey(key)), sensitiveEnvCount: envKeys.filter(isSensitiveMcpEnvKey).length, startupTimeoutMs: server.startupTimeoutMs, callTimeoutMs: server.callTimeoutMs };
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

export function addMcpServer(file: IslaConfigFileV1, profileName: string, server: McpServerConfig): IslaConfigFileV1 {
  const { profile } = resolveProfile(file, profileName);
  if ((profile.mcp?.servers ?? []).some(item => item.id === server.id)) throw new Error('MCP_SERVER_DUPLICATE');
  return replaceMcpServers(file, profileName, [...(profile.mcp?.servers ?? []), server]);
}

export function editMcpServer(file: IslaConfigFileV1, profileName: string, server: McpServerConfig): IslaConfigFileV1 {
  const { profile } = resolveProfile(file, profileName);
  const servers = [...(profile.mcp?.servers ?? [])];
  const index = servers.findIndex(item => item.id === server.id);
  if (index < 0) throw new Error('MCP_SERVER_NOT_FOUND');
  servers[index] = server;
  return replaceMcpServers(file, profileName, servers);
}

export function removeMcpServer(file: IslaConfigFileV1, profileName: string, id: string): IslaConfigFileV1 {
  const { profile } = resolveProfile(file, profileName);
  const servers = [...(profile.mcp?.servers ?? [])];
  const index = servers.findIndex(item => item.id === id);
  if (index < 0) throw new Error('MCP_SERVER_NOT_FOUND');
  servers.splice(index, 1);
  return replaceMcpServers(file, profileName, servers);
}

export async function saveMcpServers(store: ConfigStore, profileName: string, servers: readonly McpServerConfig[], expectedRevision?: string): Promise<void> {
  const loaded = await store.load();
  if (loaded.status !== 'ready') throw new Error(loaded.status === 'missing' ? 'Isla config does not exist' : loaded.status === 'empty' ? 'Isla config has no profiles' : loaded.message);
  const next = replaceMcpServers(loaded.config, profileName, servers);
  await store.save(next, expectedRevision ?? loaded.revision);
}
