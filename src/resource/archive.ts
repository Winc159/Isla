import { basename, extname, join } from "node:path";

export type ArchiveFormat = "zip" | "7z" | "rar4" | "rar5" | "gzip" | "bzip2" | "xz" | "tar" | "media" | "unknown";
export interface ArchivePart { readonly path: string; readonly index: number; readonly role: "single" | "first" | "middle" | "last" | "unknown"; }
export interface ArchiveInspection { readonly path: string; readonly format: ArchiveFormat; readonly isArchive: boolean; readonly likelyMedia: boolean; readonly normalizedName: string; readonly part?: ArchivePart; readonly confidence: "high" | "medium" | "low"; }
export interface ArchiveTool { run(args: readonly string[], signal?: AbortSignal): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>; }

const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar", ".gz", ".tgz", ".bz2", ".xz", ".tar"]);
const MEDIA_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".mp3", ".flac", ".jpg", ".png", ".pdf"]);

export function inspectArchive(path: string, header: Uint8Array, size = 0): ArchiveInspection {
  const name = basename(path);
  const format = detectArchiveFormat(header);
  const likelyMedia = detectMedia(header, name);
  const part = detectArchivePart(path);
  const normalizedName = normalizeArchiveName(name, format, part);
  const isArchive = format !== "unknown" && format !== "media";
  return { path, format, isArchive, likelyMedia, normalizedName, ...(part ? { part } : {}), confidence: isArchive ? "high" : likelyMedia ? "high" : size > 0 && ARCHIVE_EXTENSIONS.has(extname(name).toLowerCase()) ? "low" : "low" };
}

export function detectArchiveFormat(header: Uint8Array): ArchiveFormat {
  if (starts(header, [0x50, 0x4b, 0x03, 0x04]) || starts(header, [0x50, 0x4b, 0x05, 0x06]) || starts(header, [0x50, 0x4b, 0x07, 0x08])) return "zip";
  if (starts(header, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (starts(header, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])) return "rar4";
  if (starts(header, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])) return "rar5";
  if (starts(header, [0x1f, 0x8b])) return "gzip";
  if (starts(header, [0x42, 0x5a, 0x68])) return "bzip2";
  if (starts(header, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return "xz";
  if (header.length >= 265 && String.fromCharCode(...header.slice(257, 262)) === "ustar") return "tar";
  if (findBytes(header, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]) >= 0) return "rar5";
  if (findBytes(header, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) >= 0) return "rar4";
  if (header.length >= 12 && String.fromCharCode(...header.slice(4, 8)) === "ftyp") return "media";
  return "unknown";
}

export function groupArchiveParts(paths: readonly string[]): readonly ArchivePart[][] {
  const groups = new Map<string, ArchivePart[]>();
  for (const path of paths) {
    const part = detectArchivePart(path);
    if (!part) continue;
    const key = basename(path).replace(/(?:[._-](?:part)?\d{3,}|\.r\d{2})(?=\.[^.]+$|$)/iu, "").toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(part);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => group.sort((a, b) => a.index - b.index));
}

export function detectArchivePart(path: string): ArchivePart | undefined {
  const name = basename(path);
  const numeric = name.match(/(?:^|[._-])(?<index>\d{3,})$/u);
  const part = name.match(/(?:^|[._-])part(?<index>\d+)(?:\.[^.]+)?$/iu);
  const rar = name.match(/\.r(?<index>\d{2})$/iu);
  const index = numeric?.groups?.index ?? part?.groups?.index ?? (rar ? String(Number(rar.groups?.index)) : undefined);
  if (!index) return undefined;
  const n = Number(index);
  return { path, index: n, role: n === 1 || n === 0 ? "first" : "unknown" };
}

export function normalizeArchiveName(name: string, format: ArchiveFormat, part?: ArchivePart): string {
  let result = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/gu, "_").trim();
  if (part) result = result.replace(/(?:[._-](?:part)?\d{3,}|\.r\d{2})(?=\.[^.]+$|$)/iu, "");
  if (format !== "unknown" && format !== "media" && !ARCHIVE_EXTENSIONS.has(extname(result).toLowerCase())) result += `.${format === "rar4" || format === "rar5" ? "rar" : format}`;
  return result || "archive";
}

export function buildExtractionArgs(archivePath: string, outputPath: string, password?: string): readonly string[] {
  return ["x", archivePath, `-o${outputPath}`, "-y", ...(password ? [`-p${password}`] : [])];
}

export function buildRecursiveExtractionPlan(paths: readonly string[]): readonly { readonly archivePath: string; readonly outputPath: string; readonly format: ArchiveFormat }[] {
  return paths.map(path => ({ archivePath: path, outputPath: join(path.replace(/\.[^.]+$/u, ""), "contents"), format: "unknown" as ArchiveFormat }));
}

function starts(value: Uint8Array, expected: readonly number[]): boolean { return expected.every((item, index) => value[index] === item); }
function findBytes(value: Uint8Array, expected: readonly number[]): number { for (let i = 0; i <= value.length - expected.length; i += 1) if (starts(value.slice(i), expected)) return i; return -1; }
function detectMedia(header: Uint8Array, name: string): boolean { return detectArchiveFormat(header) === "media" || MEDIA_EXTENSIONS.has(extname(name).toLowerCase()); }
