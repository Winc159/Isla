import type { ProfileAppearanceSettingsV1, ProfileMemorySettingsV1, ProfileRuntimeSettingsV1 } from './schema.js';

type UnknownRecord = Record<string, unknown>;
type WarnUnknown = (value: UnknownRecord, known: readonly string[], scope: string, onWarning?: (message: string) => void) => void;

export function parseRuntime(name: string, value: unknown, warnUnknown: WarnUnknown, onWarning?: (message: string) => void): ProfileRuntimeSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.runtime must be an object`);
  warnUnknown(value, ['timeoutMs', 'modelRetries', 'maxContextTurns', 'maxContextChars', 'contextRetainTurns', 'maxContextTokens', 'maxOutputTokens', 'contextReserveTokens'], `profile ${name}.runtime`, onWarning);
  const positive = (field: string): number | undefined => value[field] === undefined ? undefined : positiveInteger(value[field], `Isla profile ${name}.runtime.${field}`);
  const timeoutMs = positive('timeoutMs'); const maxContextTurns = positive('maxContextTurns'); const maxContextChars = positive('maxContextChars'); const contextRetainTurns = positive('contextRetainTurns'); const maxContextTokens = positive('maxContextTokens'); const maxOutputTokens = positive('maxOutputTokens'); const contextReserveTokens = positive('contextReserveTokens');
  const retries = value.modelRetries === undefined ? undefined : value.modelRetries;
  if (retries !== undefined && (retries !== 0 && retries !== 1)) throw new Error(`Isla profile ${name}.runtime.modelRetries is invalid`);
  return { ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(retries !== undefined ? { modelRetries: retries } : {}), ...(maxContextTurns !== undefined ? { maxContextTurns } : {}), ...(maxContextChars !== undefined ? { maxContextChars } : {}), ...(contextRetainTurns !== undefined ? { contextRetainTurns } : {}), ...(maxContextTokens !== undefined ? { maxContextTokens } : {}), ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}), ...(contextReserveTokens !== undefined ? { contextReserveTokens } : {}) };
}
export function parseMemory(name: string, value: unknown, warnUnknown: WarnUnknown, onWarning?: (message: string) => void): ProfileMemorySettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.memory must be an object`);
  warnUnknown(value, ['enabled', 'database', 'embeddingProvider', 'embeddingModel', 'embeddingBaseURL', 'embeddingApiKey'], `profile ${name}.memory`, onWarning);
  const provider = value.embeddingProvider;
  if (provider !== undefined && provider !== 'openai' && provider !== 'local') throw new Error(`Isla profile ${name}.memory.embeddingProvider is invalid`);
  if (provider && value.embeddingModel === undefined) throw new Error(`Isla profile ${name}.memory.embeddingModel is required`);
  if (provider === 'local' && value.embeddingBaseURL === undefined) throw new Error(`Isla profile ${name}.memory.embeddingBaseURL is required`);
  return { ...(value.enabled === undefined ? {} : { enabled: booleanValue(value.enabled, `Isla profile ${name}.memory.enabled`) }), ...(value.database === undefined ? {} : { database: nonEmptyString(value.database, `Isla profile ${name}.memory.database`) }), ...(provider ? { embeddingProvider: provider, embeddingModel: nonEmptyString(value.embeddingModel, `Isla profile ${name}.memory.embeddingModel`) } : {}), ...(value.embeddingBaseURL !== undefined ? { embeddingBaseURL: validURL(value.embeddingBaseURL, `Isla profile ${name}.memory.embeddingBaseURL`) } : {}), ...(value.embeddingApiKey !== undefined ? { embeddingApiKey: nonEmptyString(value.embeddingApiKey, `Isla profile ${name}.memory.embeddingApiKey`) } : {}) };
}
export function parseAppearance(name: string, value: unknown, warnUnknown: WarnUnknown, onWarning?: (message: string) => void): ProfileAppearanceSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.appearance must be an object`);
  warnUnknown(value, ['personality', 'logLevel'], `profile ${name}.appearance`, onWarning);
  const personality = value.personality ?? 'default'; const logLevel = value.logLevel ?? 'normal';
  if (personality !== 'default' && personality !== 'minimal') throw new Error(`Isla profile ${name}.appearance.personality is invalid`);
  if (logLevel !== 'quiet' && logLevel !== 'normal' && logLevel !== 'debug') throw new Error(`Isla profile ${name}.appearance.logLevel is invalid`);
  return { personality, logLevel };
}
function isRecord(value: unknown): value is UnknownRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonEmptyString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function positiveInteger(value: unknown, field: string): number { if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${field} must be a positive integer`); return value as number; }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`); return value; }
function validURL(value: unknown, field: string): string { const text = nonEmptyString(value, field); try { new URL(text); return text; } catch { throw new Error(`${field} must be a valid URL`); } }
