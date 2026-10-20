import { randomUUID } from "node:crypto";
import type { ResourceInferenceClient } from "./inference-client.js";
import { chooseResourceName, type ResourceNameDecision } from "./naming.js";
import { basename, extname } from "node:path";

export async function chooseResourceNameWithWorker(client: ResourceInferenceClient | undefined, input: Parameters<typeof chooseResourceName>[0], contentSummary?: unknown, signal?: AbortSignal): Promise<ResourceNameDecision> {
  const deterministic = chooseResourceName(input);
  const archiveOnlyFileName = deterministic.source === "file" && (input.downloadedNames ?? []).some(value => /\.(?:zip|7z|rar|tar|gz)$/iu.test(value));
  if (deterministic.source !== "timestamp" && !archiveOnlyFileName) return deterministic;
  if (!client) return archiveOnlyFileName ? chooseResourceName({ completedAt: input.completedAt }) : deterministic;
  try {
    const result = await client.run({ requestId: randomUUID(), role: "resource-worker", task: "resource.suggest-title", schema: "resource.title-result.v1", input: { ruleTitleCandidates: input.titleCandidates ?? [], downloadedNames: input.downloadedNames ?? [], ...(contentSummary ? { contentSummary } : {}) } }, signal);
    const output = result.output as { title?: string; needsReview?: boolean };
    const title = output.title?.trim();
    const downloadedStems = (input.downloadedNames ?? []).map(value => basename(value, extname(value)).trim().toLocaleLowerCase());
    const usable = title && contentSummary !== undefined && output.needsReview !== true && !/\.(?:zip|7z|rar|tar|gz)$/iu.test(title) && !/^(?:download(?:ed)?|archive|file|unknown)$/iu.test(title) && !downloadedStems.includes(title.toLocaleLowerCase()) && !/(?:\.zip|\.7z|\.rar|压缩包|归档|downloaded?|未命名文件夹)/iu.test(title);
    if (usable) return chooseResourceName({ ...input, workerSuggestion: title });
    return chooseResourceName({ completedAt: input.completedAt });
  } catch { return archiveOnlyFileName ? chooseResourceName({ completedAt: input.completedAt }) : deterministic; }
}
