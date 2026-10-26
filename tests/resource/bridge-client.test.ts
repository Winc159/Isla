import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceBridgeClient } from '../../src/resource/bridge-client.js';
import { ResourceService, type ResourceServiceOptions } from '../../src/resource/service.js';
import { parseResourceConfig } from '../../src/resource/config.js';
import { createResourceCapability } from '../../src/tools/resource.js';

let service: ResourceService | undefined;
let directory: string | undefined;
afterEach(async () => { await service?.close(); service = undefined; if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });

describe('Resource Agent Bridge', () => {
  async function start(options: Pick<ResourceServiceOptions, 'baiduDownloader' | 'archiveOrganizer'> = {}): Promise<ResourceBridgeClient> {
    directory = mkdtempSync(join(tmpdir(), 'isla-resource-bridge-'));
    const config = parseResourceConfig(JSON.stringify({ version: 1, listen: { host: '127.0.0.1', port: 0, allowedOrigins: ['http://127.0.0.1'] }, isla: { endpoint: 'http://127.0.0.1:43110', token: 'worker-token' }, databasePath: join(directory, 'resource.sqlite'), stagingPath: join(directory, 'staging'), managedRoots: [{ id: 'library', label: 'Library', path: join(directory, 'library'), scanEnabled: true, outputEnabled: true }], defaultDestinationRootId: 'library' }));
    service = new ResourceService({ config, token: 'resource-bridge-test-token', ...options });
    const address = await service.start();
    const client = new ResourceBridgeClient(`http://${address.host}:${address.port}`, address.token);
    expect(await client.health()).toBe(true);
    return client;
  }

  it('exposes exactly six narrow tools and idempotently creates a safe job reference', async () => {
    const client = await start();
    const capability = createResourceCapability(client, 'session-test', 'turn-test');
    expect(capability.tools.map(tool => tool.definition.name)).toEqual(['resource_job_create', 'resource_job_get', 'resource_job_list', 'resource_job_cancel', 'resource_job_respond', 'resource_artifact_get']);
    const tool = capability.tools[0]!;
    const argumentsJson = JSON.stringify({ tool: 'baidu-download', inputKind: 'share-text', text: 'https://pan.baidu.com/s/fixture', destinationRootId: 'library' });
    const first = JSON.parse(await tool.execute(argumentsJson, { toolCallId: 'call-stable' }) as string) as { job: { id: string; status: string; pendingDecision?: unknown } };
    const retried = JSON.parse(await tool.execute(argumentsJson, { toolCallId: 'call-stable' }) as string) as { job: { id: string } };
    expect(retried.job.id).toBe(first.job.id);
    await expect(tool.execute(argumentsJson.replace('fixture', 'different'), { toolCallId: 'call-stable' })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(first.job.status).toBe('waiting_user');
    expect(JSON.stringify(first)).not.toContain('fixture-code');
    expect((await capability.tools[2]!.execute(JSON.stringify({ status: 'waiting_user', limit: 5 }))) as string).toContain(first.job.id);
  });

  it('requires revisions and decision IDs, and refuses to route secret values through model tools', async () => {
    const client = await start();
    const capability = createResourceCapability(client, 'session-test', 'turn-test');
    const created = JSON.parse(await capability.tools[0]!.execute(JSON.stringify({ tool: 'baidu-download', inputKind: 'share-text', text: 'https://pan.baidu.com/s/fixture', destinationRootId: 'library' }), { toolCallId: 'call-2' }) as string) as { job: { id: string; revision: number; pendingDecision: { id: string } } };
    await expect(client.cancel(created.job.id, created.job.revision + 1)).rejects.toThrow('JOB_REVISION_STALE');
    await expect(capability.tools[4]!.execute(JSON.stringify({ jobId: created.job.id, revision: created.job.revision, decisionId: created.job.pendingDecision.id, action: 'replace_input', text: 'https://pan.baidu.com/s/item?pwd=secret' }))).rejects.toThrow('RESOURCE_SECRET_INPUT_REQUIRES_UI');
    const responded = await capability.tools[4]!.execute(JSON.stringify({ jobId: created.job.id, revision: created.job.revision, decisionId: created.job.pendingDecision.id, action: 'reject' }));
    expect(responded).toContain('cancelled');
  });

  it('rejects absolute paths and unknown resource operations before making a request', async () => {
    const client = await start();
    const tool = createResourceCapability(client, 's', 't').tools[0]!;
    await expect(tool.execute(JSON.stringify({ tool: 'archive-organizer', inputKind: 'managed-file', managedRootId: 'library', relativePath: 'C:\\private\\file.zip', destinationRootId: 'library' }))).rejects.toThrow('RESOURCE_PATH_INVALID');
    await expect(tool.execute(JSON.stringify({ tool: 'arbitrary-url', inputKind: 'share-text', text: 'https://example.com', destinationRootId: 'library' }))).rejects.toThrow('RESOURCE_INPUT_INVALID');
  });

  it('keeps a Tool-created job running after the creating client disappears and exposes its finished artifact in a later turn', async () => {
    directory = mkdtempSync(join(tmpdir(), 'isla-resource-bridge-e2e-'));
    const library = join(directory, 'library'); mkdirSync(library, { recursive: true });
    const config = parseResourceConfig(JSON.stringify({ version: 1, listen: { host: '127.0.0.1', port: 0, allowedOrigins: ['http://127.0.0.1'] }, isla: { endpoint: 'http://127.0.0.1:43110', token: 'worker-token' }, databasePath: join(directory, 'resource.sqlite'), stagingPath: join(directory, 'staging'), managedRoots: [{ id: 'library', label: 'Library', path: library, scanEnabled: true, outputEnabled: true }], defaultDestinationRootId: 'library' }));
    service = new ResourceService({ config, token: 'resource-bridge-test-token', baiduDownloader: { download: async request => { if (request.destinationPath) writeFileSync(request.destinationPath, Buffer.from([0x50, 0x4b, 0x03, 0x04])); return { code: 0, stdout: '{}', stderr: '' }; } }, archiveOrganizer: { organize: async () => ({ inspection: { path: 'downloaded.bin', format: 'zip', isArchive: true, likelyMedia: false, normalizedName: 'downloaded.zip', confidence: 'high' }, outputPath: join(library, 'result'), files: [{ relativePath: 'content.txt', size: 4 }], totalBytes: 4 }) } });
    const address = await service.start();
    const baseURL = `http://${address.host}:${address.port}`;
    const creatingClient = new ResourceBridgeClient(baseURL, address.token);
    const creator = createResourceCapability(creatingClient, 'session-before-disconnect', 'turn-create');
    const created = JSON.parse(await creator.tools[0]!.execute(JSON.stringify({ tool: 'baidu-download', inputKind: 'baidu-path', path: '/fixture', destinationRootId: 'library' }), { toolCallId: 'call-persistent-job' }) as string) as { job: { id: string; revision: number; pendingDecision: { id: string } } };
    await creator.tools[4]!.execute(JSON.stringify({ jobId: created.job.id, revision: created.job.revision, decisionId: created.job.pendingDecision.id, action: 'approve' }));

    // Drop the client and capability as a CLI disconnect would; Resource owns the running work.
    const resumedClient = new ResourceBridgeClient(baseURL, address.token);
    let current = await resumedClient.get(created.job.id);
    for (let attempt = 0; attempt < 50 && current.status !== 'completed'; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 10)); current = await resumedClient.get(created.job.id); }
    expect(current.status).toBe('completed');
    expect(current.artifacts).toHaveLength(2);
    const laterTurn = createResourceCapability(resumedClient, 'session-after-reconnect', 'turn-query');
    const queried = JSON.parse(await laterTurn.tools[1]!.execute(JSON.stringify({ jobId: created.job.id })) as string) as { job: { id: string; status: string; artifacts: Array<{ id: string }> } };
    expect(queried.job).toMatchObject({ id: created.job.id, status: 'completed' });
    const artifact = JSON.parse(await laterTurn.tools[5]!.execute(JSON.stringify({ jobId: created.job.id, artifactId: queried.job.artifacts[0]!.id })) as string) as { artifact: { id: string; jobId: string } };
    expect(artifact.artifact.id).toBe(queried.job.artifacts[0]!.id);
  });
});
