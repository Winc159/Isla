import { randomUUID } from "node:crypto";
import type { ResourceInferenceClient } from "./inference-client.js";

export interface ContentManifestEntry { readonly relativePath: string; readonly kind: "file" | "directory"; readonly sizeBytes?: number; readonly extension?: string; }
export interface ContentManifest { readonly entries: readonly ContentManifestEntry[]; readonly ruleHints: { readonly archiveType?: string; readonly mediaExtensions: readonly string[]; readonly meaningfulDirectories: readonly string[]; readonly wrapperCandidates: readonly string[] }; }

export function buildContentManifest(entries: readonly ContentManifestEntry[], options: { archiveType?: string; mediaExtensions?: readonly string[]; meaningfulDirectories?: readonly string[]; wrapperCandidates?: readonly string[] } = {}): ContentManifest {
  const safe = entries.filter(entry => !entry.relativePath.includes("..") && !/^[\\/]/u.test(entry.relativePath)).slice(0, 20_000).map(entry => ({ ...entry, relativePath: entry.relativePath.slice(0, 4_096) }));
  return { entries: safe, ruleHints: { ...(options.archiveType ? { archiveType: options.archiveType.slice(0, 64) } : {}), mediaExtensions: (options.mediaExtensions ?? []).slice(0, 128).map(value => value.slice(0, 64)), meaningfulDirectories: (options.meaningfulDirectories ?? []).slice(0, 256).map(value => value.slice(0, 4_096)), wrapperCandidates: (options.wrapperCandidates ?? []).slice(0, 256).map(value => value.slice(0, 4_096)) } };
}

export async function adviseContent(client: ResourceInferenceClient | undefined, manifest: ContentManifest, signal?: AbortSignal): Promise<unknown | undefined> {
  if (!client || manifest.entries.length === 0) return undefined;
  try {
    const result = await client.run({ requestId: randomUUID(), role: "resource-worker", task: "resource.identify-content", schema: "resource.content-result.v1", input: manifest as unknown as Record<string, unknown> }, signal);
    return result.output;
  } catch { return undefined; }
}
