import { basename, extname } from "node:path";

export interface ResourceNameInput { readonly explicitName?: string; readonly titleCandidates?: readonly string[]; readonly downloadedNames?: readonly string[]; readonly workerSuggestion?: string; readonly completedAt: Date; }
export interface ResourceNameDecision { readonly name: string; readonly source: "explicit" | "rules" | "worker" | "file" | "timestamp"; readonly needsConfirmation: boolean; }

export function chooseResourceName(input: ResourceNameInput): ResourceNameDecision {
  const explicit = cleanName(input.explicitName);
  if (explicit) return { name: explicit, source: "explicit", needsConfirmation: false };
  const rules = input.titleCandidates?.map(cleanName).find(isUsefulName);
  if (rules) return { name: rules, source: "rules", needsConfirmation: false };
  const worker = cleanName(input.workerSuggestion);
  if (worker && isUsefulName(worker)) return { name: worker, source: "worker", needsConfirmation: true };
  const file = input.downloadedNames?.map(value => cleanName(basename(value, extname(value)))).find(isUsefulName);
  if (file) return { name: file, source: "file", needsConfirmation: false };
  return { name: `resource-${formatTime(input.completedAt)}`, source: "timestamp", needsConfirmation: true };
}

export function cleanName(value?: string): string | undefined {
  const cleaned = value?.normalize("NFKC").replace(/[\u0000-\u001f<>:"/\\|?*]+/gu, " ").replace(/\s+/gu, " ").trim().replace(/[. ]+$/u, "");
  return cleaned && cleaned.length <= 160 ? cleaned : cleaned?.slice(0, 160).trim();
}
function isUsefulName(value?: string): value is string { return Boolean(value && value.length >= 2 && !/^(?:\d{8,}|[a-f0-9]{16,}|resource[-_ ]?\d*)$/iu.test(value) && /\p{Script=Han}|[A-Za-z]{2,}/u.test(value)); }
function formatTime(value: Date): string { return value.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z").replace("T", "-"); }
