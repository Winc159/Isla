import { spawn } from "node:child_process";
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inspectArchive, type ArchiveInspection } from "./archive.js";

export interface ArchiveOrganizerLimits { readonly maxFiles: number; readonly maxExtractedBytes: number; readonly maxSingleFileBytes: number; readonly maxExpansionRatio: number; }
export interface ArchiveOrganizeRequest { readonly archivePath: string; readonly stagingPath: string; readonly outputPath: string; readonly password?: string; readonly passwordCandidates?: readonly string[]; }
export interface ArchiveOrganizeResult { readonly inspection: ArchiveInspection; readonly outputPath: string; readonly files: readonly { readonly relativePath: string; readonly size: number }[]; readonly totalBytes: number; readonly successfulPasswordIndex?: number; }

export class SevenZipTool {
  constructor(readonly executable: string) {}
  run(args: readonly string[], signal?: AbortSignal): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
      const abort = () => child.kill(); signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", chunk => { stdout += chunk.toString(); }); child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      child.once("error", reject); child.once("close", code => { signal?.removeEventListener("abort", abort); resolvePromise({ code: code ?? 1, stdout, stderr: stderr.slice(0, 8_192) }); });
    });
  }
}

export class ArchiveOrganizer {
  constructor(private readonly tool: SevenZipTool, private readonly limits: ArchiveOrganizerLimits) {}
  async organize(request: ArchiveOrganizeRequest, signal?: AbortSignal): Promise<ArchiveOrganizeResult> {
    const archivePath = resolve(request.archivePath); const stagingPath = resolve(request.stagingPath); const outputPath = resolve(request.outputPath);
    if (!existsSync(archivePath) || !statSync(archivePath).isFile()) throw new Error("ARCHIVE_NOT_FOUND");
    if (existsSync(outputPath)) throw new Error("OUTPUT_ALREADY_EXISTS");
    if (stagingPath === outputPath || stagingPath.startsWith(`${outputPath}${sep}`)) throw new Error("STAGING_PATH_INVALID");
    const header = readHeader(archivePath); const inspection = inspectArchive(archivePath, header, statSync(archivePath).size);
    if (!inspection.isArchive) throw new Error("ARCHIVE_FORMAT_UNSUPPORTED");
    const candidates = [...new Set([...(request.password ? [request.password] : []), ...(request.passwordCandidates ?? [])].map(value => value.trim()).filter(Boolean))].slice(0, 20);
    const initial = await this.tool.run(["t", archivePath], signal); let successfulPasswordIndex: number | undefined; let passwordArgs: string[] = [];
    if (initial.code !== 0) {
      const passwordFailure = isPasswordFailure(`${initial.stdout}\n${initial.stderr}`);
      for (let index = 0; index < candidates.length; index += 1) { const tested = await this.tool.run(["t", archivePath, `-p${candidates[index]!}`], signal); if (tested.code === 0) { successfulPasswordIndex = index; passwordArgs = [`-p${candidates[index]!}`]; break; } }
      if (successfulPasswordIndex === undefined) { const detail = `${initial.stdout}\n${initial.stderr}`; throw new Error(passwordFailure ? "ARCHIVE_PASSWORD_REQUIRED" : isMissingVolumeFailure(detail) ? "ARCHIVE_VOLUME_INCOMPLETE" : "ARCHIVE_TEST_FAILED"); }
    }
    const listed = await this.tool.run(["l", "-slt", archivePath, ...passwordArgs], signal); if (listed.code !== 0) throw new Error("ARCHIVE_LIST_FAILED");
    validateListedPaths(parseListedPaths(listed.stdout));
    mkdirSync(stagingPath, { recursive: true });
    const extracted = await this.tool.run(["x", archivePath, `-o${stagingPath}`, "-y", ...passwordArgs], signal); if (extracted.code !== 0) throw new Error("ARCHIVE_EXTRACT_FAILED");
    normalizeExtractedTree(stagingPath, archivePath);
    const files = walkFiles(stagingPath, this.limits); const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const archiveSize = Math.max(1, statSync(archivePath).size); if (totalBytes / archiveSize > this.limits.maxExpansionRatio) throw new Error("ARCHIVE_EXPANSION_RATIO_EXCEEDED");
    mkdirSync(dirname(outputPath), { recursive: true });
    try { renameSync(stagingPath, outputPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error; cpSync(stagingPath, outputPath, { recursive: true, errorOnExist: true }); rmSync(stagingPath, { recursive: true, force: true }); }
    return { inspection, outputPath, files, totalBytes, ...(successfulPasswordIndex !== undefined ? { successfulPasswordIndex } : {}) };
  }
}

export function normalizeExtractedTree(root: string, archivePath: string): void {
  removeEmptyDirectories(root, true);
  collapseGenericChildren(root);
  const archiveStem = basename(archivePath).replace(/(?:\.(?:zip|7z|rar|tar|gz|tgz|bz2|xz|mp4|bin))+$/giu, "").trim().toLowerCase();
  for (let depth = 0; depth < 5; depth += 1) {
    const entries = readdirSync(root, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0]!.isDirectory() || entries[0]!.isSymbolicLink()) break;
    const wrapper = entries[0]!; const normalized = wrapper.name.trim().toLowerCase();
    if (normalized !== archiveStem && !isGenericWrapperName(normalized)) break;
    const wrapperPath = join(root, wrapper.name);
    for (const child of readdirSync(wrapperPath)) renameSync(join(wrapperPath, child), join(root, child));
    rmdirSync(wrapperPath);
  }
  removeEmptyDirectories(root, true);
}

function collapseGenericChildren(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) collapseGenericChildren(join(directory, entry.name));
  for (let depth = 0; depth < 5; depth += 1) {
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0]!.isDirectory() || entries[0]!.isSymbolicLink() || !isGenericWrapperName(entries[0]!.name.trim().toLowerCase())) break;
    const wrapperPath = join(directory, entries[0]!.name);
    for (const child of readdirSync(wrapperPath)) renameSync(join(wrapperPath, child), join(directory, child));
    rmdirSync(wrapperPath);
  }
}

function isGenericWrapperName(name: string): boolean {
  return /^(?:新建文件夹|未命名(?:文件夹)?|无标题|内容|文件|资料|资源|下载|解压|解压后|files?|contents?|data|download|output|temp|tmp|新建文件夹\s*\(\d+\)|\d{8,14}|[0-9a-f]{16,})$/iu.test(name);
}

function isPasswordFailure(value: string): boolean { return /wrong password|password|encrypted|密码|加密/iu.test(value); }
function isMissingVolumeFailure(value: string): boolean { return /missing volume|volume is missing|缺少分卷|缺卷/iu.test(value); }

function removeEmptyDirectories(directory: string, keepRoot: boolean): boolean {
  for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) removeEmptyDirectories(join(directory, entry.name), false);
  if (!keepRoot && readdirSync(directory).length === 0) { rmdirSync(directory); return true; }
  return false;
}

function readHeader(path: string): Uint8Array { const fd = openSync(path, "r"); try { const buffer = Buffer.alloc(1024 * 1024); const length = readSync(fd, buffer, 0, buffer.length, 0); return buffer.subarray(0, length); } finally { closeSync(fd); } }
function parseListedPaths(stdout: string): string[] { return stdout.split(/\r?\n/u).filter(line => line.startsWith("Path = ")).map(line => line.slice(7)).slice(1); }
function validateListedPaths(paths: readonly string[]): void { for (const path of paths) if (isAbsolute(path) || /^[A-Za-z]:/u.test(path) || path.split(/[\\/]+/u).includes("..")) throw new Error("ARCHIVE_PATH_TRAVERSAL"); }
function walkFiles(root: string, limits: ArchiveOrganizerLimits): { relativePath: string; size: number }[] {
  const files: { relativePath: string; size: number }[] = []; const queue = [root]; let total = 0;
  while (queue.length) { const directory = queue.pop()!; for (const name of readdirSync(directory)) { const path = join(directory, name); const stats = lstatSync(path); if (stats.isSymbolicLink()) throw new Error("ARCHIVE_SYMLINK_FORBIDDEN"); if (stats.isDirectory()) queue.push(path); else if (stats.isFile()) { if (stats.size > limits.maxSingleFileBytes) throw new Error("ARCHIVE_SINGLE_FILE_LIMIT"); total += stats.size; if (total > limits.maxExtractedBytes) throw new Error("ARCHIVE_TOTAL_SIZE_LIMIT"); files.push({ relativePath: relative(root, path), size: stats.size }); if (files.length > limits.maxFiles) throw new Error("ARCHIVE_FILE_COUNT_LIMIT"); } } }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
