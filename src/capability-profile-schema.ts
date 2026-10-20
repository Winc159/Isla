import type { ProfileCapabilitiesSettingsV1 } from './config.js';

export function parseCapabilityProfileSettings(name: string, value: unknown, warnUnknown: (value: Record<string, unknown>, known: readonly string[], scope: string) => void): ProfileCapabilitiesSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.capabilities must be an object`);
  const arrays = ['skillAllow', 'skillDeny', 'mcpServerAllow', 'mcpServerDeny', 'mcpToolAllow', 'mcpToolDeny'] as const;
  const result: Record<string, unknown> = {};
  warnUnknown(value, [...arrays, 'maxTools', 'maxSchemaBytes', 'maxSkillDescriptionChars', 'maxSkillCatalogChars'], `profile ${name}.capabilities`);
  for (const key of arrays) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some(item => typeof item !== 'string' || !item.trim())) throw new Error(`Isla profile ${name}.capabilities.${key} must be an array of strings`);
    result[key] = Object.freeze([...(value[key] as string[])]);
  }
  for (const key of ['maxTools', 'maxSchemaBytes', 'maxSkillDescriptionChars', 'maxSkillCatalogChars'] as const) {
    if (value[key] === undefined) continue;
    if (!Number.isInteger(value[key]) || (value[key] as number) <= 0) throw new Error(`Isla profile ${name}.capabilities.${key} must be a positive integer`);
    result[key] = value[key];
  }
  return Object.freeze(result as ProfileCapabilitiesSettingsV1);
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
