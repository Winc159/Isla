import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { downloadVerifiedArtifact, type ArtifactDownloadDependencies } from './download.js';
import { extractTarGzip } from './archive.js';
import { scrubEnvironment } from '../tools/subprocess-runner.js';

export interface DependencyManifestV1 {
  readonly id: string;
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly source: string;
  readonly sha256: string;
  readonly maxDownloadBytes: number;
  readonly archive: 'tar.gz';
  readonly executables: readonly string[];
  readonly license: string;
  readonly versionProbe: { readonly executable: string; readonly argv: readonly string[]; readonly expected: string };
}

export interface InstalledDependencyV1 {
  readonly id: string;
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly installPath: string;
  readonly executables: Readonly<Record<string, string>>;
  readonly license: string;
  readonly sha256: string;
  readonly installedAt: string;
}
export interface AvailableDependencyV1 { readonly id: string; readonly version: string; readonly platform: NodeJS.Platform; readonly arch: string; readonly sourceHost: string; readonly license: string; }

export interface DependencyManagerDependencies extends ArtifactDownloadDependencies {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly now?: () => Date;
  readonly extractArchive?: typeof extractTarGzip;
  readonly verifyVersion?: typeof verifyVersion;
}

interface RegistryV1 { readonly version: 1; readonly dependencies: readonly InstalledDependencyV1[]; }

export class DependencyManager {
  private readonly operations = new Map<string, Promise<void>>();
  private readonly manifests: readonly DependencyManifestV1[];
  private readonly root: string;

  constructor(options: { readonly manifests: readonly DependencyManifestV1[]; readonly root?: string; readonly dependencies?: DependencyManagerDependencies }) {
    this.manifests = options.manifests.map(validateDependencyManifest);
    this.root = resolve(options.root ?? join(homedir(), '.isla', 'toolchains'));
    this.dependencies = options.dependencies ?? {};
    const keys = this.manifests.map(manifest => `${manifest.id}\0${manifest.version}\0${manifest.platform}\0${manifest.arch}`);
    if (new Set(keys).size !== keys.length) throw new Error('DEPENDENCY_MANIFEST_DUPLICATE');
  }

  private readonly dependencies: DependencyManagerDependencies;

  async list(): Promise<readonly InstalledDependencyV1[]> {
    return (await this.readRegistry()).dependencies;
  }

  available(): readonly AvailableDependencyV1[] {
    const platform = this.dependencies.platform ?? process.platform;
    const arch = this.dependencies.arch ?? process.arch;
    return this.manifests.filter(item => item.platform === platform && item.arch === arch).map(item => ({ id: item.id, version: item.version, platform: item.platform, arch: item.arch, sourceHost: new URL(item.source).hostname.toLowerCase(), license: item.license }));
  }

  sourceHost(id: string, version?: string): string {
    const manifest = this.manifests.find(item => item.id === id && (version === undefined || item.version === version) && item.platform === (this.dependencies.platform ?? process.platform) && item.arch === (this.dependencies.arch ?? process.arch));
    if (!manifest) throw new Error('DEPENDENCY_UNAVAILABLE_FOR_PLATFORM');
    return new URL(manifest.source).hostname.toLowerCase();
  }

  async resolveExecutable(id: string, executableId: string, version?: string): Promise<string> {
    if (!isValidId(id) || !isValidRelativePath(executableId)) throw new Error('DEPENDENCY_EXECUTABLE_INVALID');
    const entry = (await this.readRegistry()).dependencies.find(item => item.id === id && (version === undefined || item.version === version));
    if (!entry || !await this.verifyInstalled(entry)) throw new Error('DEPENDENCY_NOT_INSTALLED');
    const executable = entry.executables[executableId];
    if (!executable) throw new Error('DEPENDENCY_EXECUTABLE_NOT_REGISTERED');
    return executable;
  }

  async install(id: string, versionConstraint?: string, signal?: AbortSignal): Promise<InstalledDependencyV1> {
    if (!isValidId(id)) throw new Error('DEPENDENCY_ID_INVALID');
    return this.withLock(id, () => this.installLocked(id, versionConstraint, signal));
  }

  async uninstall(id: string, version?: string): Promise<boolean> {
    if (!isValidId(id)) throw new Error('DEPENDENCY_ID_INVALID');
    return this.withLock(id, async () => {
    const current = await this.readRegistry();
    const selected = current.dependencies.filter(entry => entry.id === id && (version === undefined || entry.version === version));
    if (selected.length === 0) return false;
    for (const entry of selected) await this.assertManagedPath(entry.installPath, id, entry.version);
    const moved: Array<{ readonly from: string; readonly to: string }> = [];
    try {
      for (const entry of selected) {
        const from = entry.installPath;
        const to = `${from}.remove-${randomUUID()}`;
        await rename(from, to);
        moved.push({ from, to });
      }
      const remaining = current.dependencies.filter(entry => !selected.includes(entry));
      await this.writeRegistry({ version: 1, dependencies: remaining });
    } catch (error) {
      for (const item of moved.reverse()) await rename(item.to, item.from).catch(() => undefined);
      throw error;
    }
    await Promise.all(moved.map(item => rm(item.to, { recursive: true, force: true })));
    return true;
    });
  }

  private async withLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolveGate => { release = resolveGate; });
    const queued = previous.then(() => gate, () => gate);
    this.operations.set(id, queued);
    await previous.catch(() => undefined);
    try { return await action(); }
    finally {
      release();
      if (this.operations.get(id) === queued) this.operations.delete(id);
    }
  }

  private async installLocked(id: string, versionConstraint?: string, signal?: AbortSignal): Promise<InstalledDependencyV1> {
    const installed = await this.readRegistry();
    const existing = installed.dependencies.find(entry => entry.id === id && matchesConstraint(entry.version, versionConstraint));
    if (existing && await this.verifyInstalled(existing)) return existing;
    const manifest = this.selectManifest(id, versionConstraint);
    if (signal?.aborted) throw new Error('DEPENDENCY_INSTALL_CANCELLED');
    const dependencyRoot = join(this.root, id);
    const target = join(dependencyRoot, manifest.version);
    await mkdir(dependencyRoot, { recursive: true });
    try { await access(target); throw new Error('DEPENDENCY_INSTALL_TARGET_EXISTS'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const staging = join(dependencyRoot, `.staging-${randomUUID()}`);
    const archive = join(dependencyRoot, `.artifact-${randomUUID()}.tar.gz`);
    let published = false;
    try {
      await mkdir(staging, { recursive: false });
      const downloaded = await downloadVerifiedArtifact({ source: manifest.source, sha256: manifest.sha256, maxBytes: manifest.maxDownloadBytes, targetPath: archive, ...(signal ? { signal } : {}) }, this.dependencies);
      if (signal?.aborted) throw new Error('DEPENDENCY_INSTALL_CANCELLED');
      await (this.dependencies.extractArchive ?? extractTarGzip)(archive, staging, manifest.executables);
      const executableMap: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const executable of manifest.executables) executableMap[executable] = join(target, ...executable.split('/'));
      await (this.dependencies.verifyVersion ?? verifyVersion)(join(staging, ...manifest.versionProbe.executable.split('/')), manifest.versionProbe.argv, manifest.versionProbe.expected, staging);
      if (signal?.aborted) throw new Error('DEPENDENCY_INSTALL_CANCELLED');
      await rename(staging, target);
      published = true;
      const entry: InstalledDependencyV1 = { id, version: manifest.version, platform: manifest.platform, arch: manifest.arch, installPath: target, executables: executableMap, license: manifest.license, sha256: downloaded.sha256, installedAt: (this.dependencies.now ?? (() => new Date()))().toISOString() };
      await this.writeRegistry({ version: 1, dependencies: [...installed.dependencies.filter(item => !(item.id === id && item.version === manifest.version)), entry] });
      return entry;
    } catch (error) {
      if (published) await rm(target, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      await rm(archive, { force: true }).catch(() => undefined);
    }
  }

  private selectManifest(id: string, constraint?: string): DependencyManifestV1 {
    const platform = this.dependencies.platform ?? process.platform;
    const arch = this.dependencies.arch ?? process.arch;
    const manifest = this.manifests.find(item => item.id === id && item.platform === platform && item.arch === arch && matchesConstraint(item.version, constraint));
    if (!manifest) throw new Error('DEPENDENCY_UNAVAILABLE_FOR_PLATFORM');
    return manifest;
  }

  private async verifyInstalled(entry: InstalledDependencyV1): Promise<boolean> {
    try {
      await this.assertManagedPath(entry.installPath, entry.id, entry.version);
      if (!this.isSafeRegistryEntry(entry)) return false;
      for (const [path, executable] of Object.entries(entry.executables)) {
        const actual = await realpath(executable);
        if (!samePath(actual, resolve(entry.installPath, ...path.split('/')))) return false;
      }
      return true;
    } catch { return false; }
  }

  private isSafeRegistryEntry(entry: InstalledDependencyV1): boolean {
    const expectedRoot = resolve(this.root, entry.id, entry.version);
    if (!samePath(resolve(entry.installPath), expectedRoot) || Object.keys(entry.executables).length === 0) return false;
    return Object.entries(entry.executables).every(([path, executable]) => isValidRelativePath(path) && samePath(resolve(executable), resolve(expectedRoot, ...path.split('/'))));
  }

  private async assertManagedPath(path: string, id: string, version: string): Promise<void> {
    const expected = resolve(this.root, id, version);
    const candidate = resolve(path);
    const rel = relative(expected, candidate);
    if (!samePath(candidate, expected) || rel !== '') throw new Error('DEPENDENCY_REGISTRY_PATH_INVALID');
    const actual = await realpath(candidate);
    if (!samePath(actual, expected)) throw new Error('DEPENDENCY_REGISTRY_PATH_INVALID');
  }

  private async readRegistry(): Promise<RegistryV1> {
    const registryPath = join(this.root, 'registry-v1.json');
    try {
      const value: unknown = JSON.parse(await readFile(registryPath, 'utf8'));
      if (!isRegistry(value)) throw new Error('DEPENDENCY_REGISTRY_INVALID');
      for (const entry of value.dependencies) if (!isValidId(entry.id) || !isValidVersion(entry.version) || !this.isSafeRegistryEntry(entry)) throw new Error('DEPENDENCY_REGISTRY_INVALID');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, dependencies: [] };
      throw error;
    }
  }

  private async writeRegistry(registry: RegistryV1): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, 'registry-v1.json');
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { await rename(temporary, path); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
  }
}

export function validateDependencyManifest(manifest: DependencyManifestV1): DependencyManifestV1 {
  if (!isValidId(manifest.id) || !isValidVersion(manifest.version) || !manifest.license.trim() || manifest.archive !== 'tar.gz' || !/^[a-f0-9]{64}$/iu.test(manifest.sha256) || !Number.isSafeInteger(manifest.maxDownloadBytes) || manifest.maxDownloadBytes < 1 || manifest.maxDownloadBytes > 2_000_000_000) throw new Error('DEPENDENCY_MANIFEST_INVALID');
  const source = new URL(manifest.source);
  if (source.protocol !== 'https:' || source.username || source.password || source.hash || source.port) throw new Error('DEPENDENCY_MANIFEST_INVALID');
  if (!manifest.executables.length || manifest.executables.some(path => !isValidRelativePath(path)) || !isValidRelativePath(manifest.versionProbe.executable) || !manifest.executables.includes(manifest.versionProbe.executable) || manifest.versionProbe.argv.length > 32 || manifest.versionProbe.argv.some(argument => typeof argument !== 'string' || Buffer.byteLength(argument, 'utf8') > 4096) || manifest.versionProbe.expected !== manifest.version) throw new Error('DEPENDENCY_MANIFEST_INVALID');
  if (source.search) throw new Error('DEPENDENCY_MANIFEST_INVALID');
  return Object.freeze({ ...manifest, source: source.href, executables: Object.freeze([...manifest.executables]), versionProbe: Object.freeze({ ...manifest.versionProbe, argv: Object.freeze([...manifest.versionProbe.argv]) }) });
}

async function verifyVersion(executable: string, argv: readonly string[], expected: string, cwd: string): Promise<void> {
  const child = spawn(executable, [...argv], { cwd, env: scrubEnvironment(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let failed = false;
  const collect = (chunk: Buffer) => { if (output.length < 16_000) output += chunk.toString('utf8').slice(0, 16_000 - output.length); };
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  const timeout = setTimeout(() => { failed = true; child.kill(); }, 10_000); timeout.unref();
  try {
    const exitCode = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('close', code => resolveExit(code)); });
    if (failed || exitCode !== 0 || !output.includes(expected)) throw new Error('DEPENDENCY_VERSION_VERIFICATION_FAILED');
  } finally { clearTimeout(timeout); }
}

function matchesConstraint(version: string, constraint?: string): boolean {
  if (!constraint || constraint === '*') return true;
  if (constraint.startsWith('^')) return version.split('.')[0] === constraint.slice(1).split('.')[0] && isValidVersion(constraint.slice(1));
  return version === constraint;
}

function isRegistry(value: unknown): value is RegistryV1 { return isRecord(value) && value.version === 1 && Array.isArray(value.dependencies) && value.dependencies.every(entry => isRecord(entry) && typeof entry.id === 'string' && typeof entry.version === 'string' && typeof entry.platform === 'string' && typeof entry.arch === 'string' && typeof entry.installPath === 'string' && isRecord(entry.executables) && typeof entry.license === 'string' && typeof entry.sha256 === 'string' && typeof entry.installedAt === 'string'); }
function isValidId(value: string): boolean { return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value); }
function isValidVersion(value: string): boolean { return /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(value); }
function isValidRelativePath(value: string): boolean { return Boolean(value) && !isAbsolute(value) && !value.includes('\\') && !value.split('/').some(part => part === '' || part === '.' || part === '..'); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function samePath(left: string, right: string): boolean { return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right; }
