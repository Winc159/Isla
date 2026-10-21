import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type { LocalRuntimeConfigV1 } from "../config/local-runtime.js";

export interface ResourceManagedRootV1 {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly scanEnabled: boolean;
  readonly outputEnabled: boolean;
}

export interface ResourceConfigV1 {
  readonly version: 1;
  readonly listen: { readonly host: string; readonly port: number; readonly allowedOrigins: readonly string[] };
  readonly isla: { readonly endpoint: string; readonly token: string };
  readonly databasePath: string;
  readonly stagingPath: string;
  readonly managedRoots: readonly ResourceManagedRootV1[];
  readonly defaultDestinationRootId: string;
  readonly concurrency: { readonly download: number; readonly inspection: number; readonly extraction: number; readonly inference: number };
  readonly scanning: { readonly intervalMs: number; readonly settleMs: number };
  readonly limits: { readonly maxInputChars: number; readonly maxFiles: number; readonly maxExtractedBytes: number; readonly maxSingleFileBytes: number; readonly maxExpansionRatio: number };
}

const DEFAULT_CONCURRENCY = { download: 2, inspection: 2, extraction: 1, inference: 2 } as const;
const DEFAULT_SCANNING = { intervalMs: 30_000, settleMs: 10_000 } as const;
const DEFAULT_LIMITS = { maxInputChars: 20_000, maxFiles: 20_000, maxExtractedBytes: 500_000_000_000, maxSingleFileBytes: 200_000_000_000, maxExpansionRatio: 200 } as const;

export interface ResourceUserConfigV1 {
  readonly version: 1;
  readonly managedRoots: readonly ResourceManagedRootV1[];
  readonly defaultDestinationRootId: string;
}

export async function loadOrCreateResourceConfig(path: string, runtime: LocalRuntimeConfigV1, defaultResourceDirectory = join(dirname(path), "resources")): Promise<ResourceConfigV1> {
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const initial: ResourceUserConfigV1 = { version: 1, managedRoots: [{ id: "resources", label: "资源目录", path: defaultResourceDirectory, scanEnabled: true, outputEnabled: true }], defaultDestinationRootId: "resources" };
    await mkdir(dirname(path), { recursive: true });
    source = `${JSON.stringify(initial, null, 2)}\n`;
    try { await writeFile(path, source, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
    catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      source = await readFile(path, "utf8");
    }
    await chmod(path, 0o600).catch(() => {});
  }
  const config = parseResourceConfig(source, { directory: dirname(path), runtime });
  await Promise.all([mkdir(dirname(config.databasePath), { recursive: true }), mkdir(config.stagingPath, { recursive: true }), ...config.managedRoots.map(root => mkdir(root.path, { recursive: true }))]);
  return config;
}

export function parseResourceConfig(source: string, defaults?: { readonly directory: string; readonly runtime: LocalRuntimeConfigV1 }): ResourceConfigV1 {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("Invalid Resource config JSON"); }
  const root = object(value, "config");
  if (root.version !== 1) throw new Error("Resource config version must be 1");
  const listen = root.listen === undefined && defaults ? { host: defaults.runtime.resource.host, port: defaults.runtime.resource.port, allowedOrigins: [`http://${defaults.runtime.resource.host}:${defaults.runtime.resource.port}`] } : object(root.listen, "listen");
  const isla = root.isla === undefined && defaults ? { endpoint: `http://${defaults.runtime.host.host}:${defaults.runtime.host.port}`, token: defaults.runtime.host.token } : object(root.isla, "isla");
  const managedRoots = array(root.managedRoots, "managedRoots").map((item, index) => parseManagedRoot(item, index));
  if (managedRoots.length === 0) throw new Error("managedRoots must contain at least one root");
  const ids = managedRoots.map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("managedRoots ids must be unique");
  const defaultDestinationRootId = text(root.defaultDestinationRootId, "defaultDestinationRootId", 128);
  const defaultRoot = managedRoots.find(item => item.id === defaultDestinationRootId);
  if (!defaultRoot?.outputEnabled) throw new Error("defaultDestinationRootId must reference an output-enabled managed root");
  const endpoint = httpUrl(isla.endpoint, "isla.endpoint");
  const token = text(isla.token, "isla.token", 4_096);
  const concurrency = optionalObject(root.concurrency, "concurrency");
  const scanning = optionalObject(root.scanning, "scanning");
  const limits = optionalObject(root.limits, "limits");
  return {
    version: 1,
    listen: {
      host: text(listen.host, "listen.host", 255),
      port: boundedInteger(listen.port, "listen.port", 0, 65_535),
      allowedOrigins: array(listen.allowedOrigins, "listen.allowedOrigins").map((item, index) => origin(item, `listen.allowedOrigins[${index}]`)),
    },
    isla: { endpoint, token },
    databasePath: absolutePath(root.databasePath ?? (defaults ? join(defaults.directory, "resource.sqlite") : undefined), "databasePath"),
    stagingPath: absolutePath(root.stagingPath ?? (defaults ? join(defaults.directory, "staging") : undefined), "stagingPath"),
    managedRoots,
    defaultDestinationRootId,
    concurrency: {
      download: boundedInteger(concurrency.download ?? DEFAULT_CONCURRENCY.download, "concurrency.download", 2, 16),
      inspection: boundedInteger(concurrency.inspection ?? DEFAULT_CONCURRENCY.inspection, "concurrency.inspection", 1, 16),
      extraction: boundedInteger(concurrency.extraction ?? DEFAULT_CONCURRENCY.extraction, "concurrency.extraction", 1, 8),
      inference: boundedInteger(concurrency.inference ?? DEFAULT_CONCURRENCY.inference, "concurrency.inference", 1, 16),
    },
    scanning: {
      intervalMs: boundedInteger(scanning.intervalMs ?? DEFAULT_SCANNING.intervalMs, "scanning.intervalMs", 1_000, 3_600_000),
      settleMs: boundedInteger(scanning.settleMs ?? DEFAULT_SCANNING.settleMs, "scanning.settleMs", 1_000, 3_600_000),
    },
    limits: {
      maxInputChars: boundedInteger(limits.maxInputChars ?? DEFAULT_LIMITS.maxInputChars, "limits.maxInputChars", 1, 100_000),
      maxFiles: boundedInteger(limits.maxFiles ?? DEFAULT_LIMITS.maxFiles, "limits.maxFiles", 1, 1_000_000),
      maxExtractedBytes: boundedInteger(limits.maxExtractedBytes ?? DEFAULT_LIMITS.maxExtractedBytes, "limits.maxExtractedBytes", 1, Number.MAX_SAFE_INTEGER),
      maxSingleFileBytes: boundedInteger(limits.maxSingleFileBytes ?? DEFAULT_LIMITS.maxSingleFileBytes, "limits.maxSingleFileBytes", 1, Number.MAX_SAFE_INTEGER),
      maxExpansionRatio: boundedInteger(limits.maxExpansionRatio ?? DEFAULT_LIMITS.maxExpansionRatio, "limits.maxExpansionRatio", 1, 100_000),
    },
  };
}

function parseManagedRoot(value: unknown, index: number): ResourceManagedRootV1 {
  const item = object(value, `managedRoots[${index}]`);
  const id = text(item.id, `managedRoots[${index}].id`, 128);
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(id)) throw new Error(`managedRoots[${index}].id is invalid`);
  return {
    id,
    label: text(item.label, `managedRoots[${index}].label`, 128),
    path: absolutePath(item.path, `managedRoots[${index}].path`),
    scanEnabled: boolean(item.scanEnabled, `managedRoots[${index}].scanEnabled`),
    outputEnabled: boolean(item.outputEnabled, `managedRoots[${index}].outputEnabled`),
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function optionalObject(value: unknown, name: string): Record<string, unknown> { return value === undefined ? {} : object(value, name); }
function array(value: unknown, name: string): readonly unknown[] { if (!Array.isArray(value)) throw new Error(`${name} must be an array`); return value; }
function text(value: unknown, name: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} must be a non-empty string`); return value; }
function boolean(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw new Error(`${name} must be boolean`); return value; }
function boundedInteger(value: unknown, name: string, min: number, max: number): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${name} must be an integer between ${min} and ${max}`); return value as number; }
function absolutePath(value: unknown, name: string): string { const path = text(value, name, 4_096); if (!isAbsolute(path)) throw new Error(`${name} must be absolute`); return normalize(path); }
function httpUrl(value: unknown, name: string): string { const url = new URL(text(value, name, 2_048)); if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${name} must use HTTP or HTTPS`); return url.toString().replace(/\/$/u, ""); }
function origin(value: unknown, name: string): string { const url = new URL(text(value, name, 2_048)); if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== url.toString().replace(/\/$/u, "")) throw new Error(`${name} must be an HTTP origin without a path`); return url.origin; }
