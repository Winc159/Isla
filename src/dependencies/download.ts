import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolvePublicAddresses, type PublicAddress } from '../web/network.js';
import { requestPinned, type PinnedResponse } from '../web/transport.js';

const MAX_ARTIFACT_BYTES = 2_000_000_000;

export interface ArtifactDownloadRequest {
  readonly source: string;
  readonly sha256: string;
  readonly maxBytes: number;
  readonly targetPath: string;
  readonly signal?: AbortSignal;
}

export interface ArtifactDownloadDependencies {
  readonly resolveAddresses?: (hostname: string, signal: AbortSignal) => Promise<PublicAddress[]>;
  readonly requestPinned?: (url: URL, addresses: readonly PublicAddress[], signal: AbortSignal) => Promise<PinnedResponse>;
}

export async function downloadVerifiedArtifact(request: ArtifactDownloadRequest, dependencies: ArtifactDownloadDependencies = {}): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const url = validateSource(request.source);
  if (!/^[a-f0-9]{64}$/iu.test(request.sha256) || !Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > MAX_ARTIFACT_BYTES) throw new Error('DEPENDENCY_MANIFEST_INVALID');
  if (request.signal?.aborted) throw new Error('DEPENDENCY_INSTALL_CANCELLED');
  const signal = request.signal ?? new AbortController().signal;
  const addresses = await (dependencies.resolveAddresses ?? ((host, activeSignal) => resolvePublicAddresses(host, activeSignal)))(url.hostname, signal);
  if (request.signal?.aborted) throw new Error('DEPENDENCY_INSTALL_CANCELLED');
  const pinned = await (dependencies.requestPinned ?? ((target, ips, activeSignal) => requestPinned(target, ips, { accept: 'application/octet-stream' }, activeSignal)))(url, addresses, signal);
  const temporaryPath = `${resolve(request.targetPath)}.${randomUUID()}.partial`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const response = pinned.response;
    if (response.status >= 300 && response.status < 400) throw new Error('DEPENDENCY_REDIRECT_BLOCKED');
    if (response.status !== 200) throw new Error(`DEPENDENCY_DOWNLOAD_HTTP_${response.status}`);
    const declaredBytes = response.headers.get('content-length');
    if (declaredBytes !== null && Number.isFinite(Number(declaredBytes)) && Number(declaredBytes) > request.maxBytes) throw new Error('DEPENDENCY_ARTIFACT_TOO_LARGE');
    if (!response.body) throw new Error('DEPENDENCY_ARTIFACT_EMPTY');
    await mkdir(dirname(temporaryPath), { recursive: true });
    handle = await open(temporaryPath, 'wx', 0o600);
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for (;;) {
        if (request.signal?.aborted) throw new Error('DEPENDENCY_INSTALL_CANCELLED');
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > request.maxBytes) throw new Error('DEPENDENCY_ARTIFACT_TOO_LARGE');
        hash.update(part.value);
        await handle.writeFile(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const actualSha256 = hash.digest('hex');
    if (bytes === 0) throw new Error('DEPENDENCY_ARTIFACT_EMPTY');
    if (actualSha256 !== request.sha256.toLowerCase()) throw new Error('DEPENDENCY_HASH_MISMATCH');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, resolve(request.targetPath));
    return { bytes, sha256: actualSha256 };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally { await pinned.close(); }
}

function validateSource(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('DEPENDENCY_MANIFEST_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) throw new Error('DEPENDENCY_MANIFEST_INVALID');
  return url;
}
