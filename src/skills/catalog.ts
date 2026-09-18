import { access, readdir } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSkillFile, parseSkillText } from "./parser.js";
import type { SkillCatalogEntry, SkillDefinition, SkillDiagnostic, SkillSource } from "./types.js";

export interface SkillCatalogResult {
  readonly entries: readonly SkillCatalogEntry[];
  readonly diagnostics: readonly SkillDiagnostic[];
}

export interface SkillCatalogOptions {
  readonly workspaceRoot: string;
  readonly personalRoot: string;
  readonly enabled?: boolean;
  readonly maxSkillCount?: number;
  readonly maxDescriptionChars?: number;
  readonly maxBodyChars?: number;
  readonly signal?: AbortSignal;
}

export class SkillCatalog {
  constructor(private readonly options: SkillCatalogOptions) {}

  async list(): Promise<SkillCatalogResult> {
    if (this.options.enabled === false) return { entries: [], diagnostics: [] };
    const chosen = new Map<string, SkillCatalogEntry>();
    const diagnostics: SkillDiagnostic[] = [];
    for (const item of [
      { root: this.options.personalRoot, source: "personal" as const },
      { root: this.options.workspaceRoot, source: "workspace" as const },
    ]) {
      for (const definition of await this.readRoot(item.root, item.source, diagnostics)) {
        if (!chosen.has(definition.name) || item.source === "workspace") chosen.set(definition.name, toEntry(definition));
      }
    }
    const entries = [...chosen.values()].sort((left, right) => left.name.localeCompare(right.name));
    const max = this.options.maxSkillCount ?? 64;
    return { entries: entries.slice(0, max), diagnostics };
  }

  listSync(): SkillCatalogResult {
    if (this.options.enabled === false) return { entries: [], diagnostics: [] };
    const chosen = new Map<string, SkillCatalogEntry>();
    const diagnostics: SkillDiagnostic[] = [];
    for (const item of [
      { root: this.options.personalRoot, source: "personal" as const },
      { root: this.options.workspaceRoot, source: "workspace" as const },
    ]) {
      if (!existsSync(item.root)) continue;
      for (const directory of readdirSync(item.root, { withFileTypes: true })) {
        if (!directory.isDirectory()) continue;
        const path = join(item.root, directory.name, "SKILL.md");
        try {
          const parsed = parseSkillTextSync(path, item.source, this.options);
          if (parsed.definition && (!chosen.has(parsed.definition.name) || item.source === "workspace")) chosen.set(parsed.definition.name, toEntry(parsed.definition));
          else if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
        } catch { diagnostics.push({ code: "SKILL_READ_FAILED", name: directory.name }); }
      }
    }
    const max = this.options.maxSkillCount ?? 64;
    return { entries: [...chosen.values()].sort((left, right) => left.name.localeCompare(right.name)).slice(0, max), diagnostics };
  }

  loadSync(name: string): SkillDefinition | undefined {
    const entry = this.listSync().entries.find(item => item.name === name);
    if (!entry) return undefined;
    const root = entry.source === "workspace" ? this.options.workspaceRoot : this.options.personalRoot;
    try { return parseSkillTextSync(resolve(root, name, "SKILL.md"), entry.source, this.options).definition; } catch { return undefined; }
  }

  async load(name: string, signal = this.options.signal): Promise<SkillDefinition | undefined> {
    if (this.options.enabled === false) return undefined;
    const listed = await this.list();
    const entry = listed.entries.find(item => item.name === name);
    if (!entry) return undefined;
    const root = entry.source === "workspace" ? this.options.workspaceRoot : this.options.personalRoot;
    const path = resolve(root, name, "SKILL.md");
    const parsed = await parseSkillFile(path, entry.source, {
      ...(this.options.maxDescriptionChars === undefined ? {} : { maxDescriptionChars: this.options.maxDescriptionChars }),
      ...(this.options.maxBodyChars === undefined ? {} : { maxBodyChars: this.options.maxBodyChars }),
      ...(signal === undefined ? {} : { signal }),
    });
    return parsed.definition;
  }

  private async readRoot(root: string, source: SkillSource, diagnostics: SkillDiagnostic[]): Promise<SkillDefinition[]> {
    this.options.signal?.throwIfAborted();
    try { await access(root); } catch { return []; }
    const items = await readdir(root, { withFileTypes: true });
    const results: SkillDefinition[] = [];
    for (const item of items) {
      this.options.signal?.throwIfAborted();
      if (!item.isDirectory()) continue;
      const path = join(root, item.name, "SKILL.md");
      const parsed = await parseSkillFile(path, source, {
        ...(this.options.maxDescriptionChars === undefined ? {} : { maxDescriptionChars: this.options.maxDescriptionChars }),
        ...(this.options.maxBodyChars === undefined ? {} : { maxBodyChars: this.options.maxBodyChars }),
        ...(this.options.signal === undefined ? {} : { signal: this.options.signal }),
      });
      if (parsed.definition) results.push(parsed.definition); else if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
    }
    return results;
  }
}

function parseSkillTextSync(path: string, source: SkillSource, options: SkillCatalogOptions) {
  return parseSkillFileText(readFileSync(path, "utf8"), path, source, options);
}

function parseSkillFileText(text: string, path: string, source: SkillSource, options: SkillCatalogOptions) {
  return parseSkillText(text, path, source, {
    ...(options.maxDescriptionChars === undefined ? {} : { maxDescriptionChars: options.maxDescriptionChars }),
    ...(options.maxBodyChars === undefined ? {} : { maxBodyChars: options.maxBodyChars }),
  });
}

function toEntry(definition: SkillDefinition): SkillCatalogEntry {
  const { content: _content, resourceDirectory: _resourceDirectory, ...entry } = definition;
  return entry;
}
