import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { SkillDefinition, SkillDiagnostic } from "./types.js";

export const DEFAULT_SKILL_DESCRIPTION_CHARS = 500;
export const DEFAULT_SKILL_BODY_CHARS = 100_000;
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSkillName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

export async function parseSkillFile(
  path: string,
  source: SkillDefinition["source"],
  options: { readonly maxDescriptionChars?: number; readonly maxBodyChars?: number; readonly signal?: AbortSignal } = {},
): Promise<{ readonly definition?: SkillDefinition; readonly diagnostic?: SkillDiagnostic }> {
  options.signal?.throwIfAborted();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { diagnostic: { code: "SKILL_READ_FAILED", name: basename(dirname(path)) } };
  }
  options.signal?.throwIfAborted();
  return parseSkillText(text, path, source, options);
}

export function parseSkillText(
  text: string,
  path: string,
  source: SkillDefinition["source"],
  options: { readonly maxDescriptionChars?: number; readonly maxBodyChars?: number } = {},
): { readonly definition?: SkillDefinition; readonly diagnostic?: SkillDiagnostic } {
  const maxDescriptionChars = options.maxDescriptionChars ?? DEFAULT_SKILL_DESCRIPTION_CHARS;
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_SKILL_BODY_CHARS;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "---") return { diagnostic: { code: "SKILL_INVALID", name: basename(path) } };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { diagnostic: { code: "SKILL_INVALID", name: basename(path) } };
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const match = /^(name|description|model-invocable|user-invocable):[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) fields.set(key, value.trim());
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || !isSkillName(name)) return { diagnostic: { code: "SKILL_INVALID_NAME", ...(name ? { name } : {}) } };
  if (!description || description.length > maxDescriptionChars) return { diagnostic: { code: "SKILL_TOO_LARGE", name } };
  const expectedDirectory = basename(dirname(path));
  if (name !== expectedDirectory) return { diagnostic: { code: "SKILL_INVALID_NAME", name } };
  const content = lines.slice(end + 1).join("\n").trim();
  if (!content || content.length > maxBodyChars) return { diagnostic: { code: "SKILL_TOO_LARGE", name } };
  const modelInvocable = parseBoolean(fields.get("model-invocable"));
  const userInvocable = parseBoolean(fields.get("user-invocable"));
  if (modelInvocable === undefined || userInvocable === undefined) return { diagnostic: { code: "SKILL_INVALID", name } };
  return {
    definition: Object.freeze({ name, description, source, modelInvocable, userInvocable, content, resourceDirectory: dirname(path) }),
  };
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return true;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
