import { describe, expect, it } from 'vitest';
import { createSessionFactory } from '../../src/runtime/session-factory.js';
import { IslaRuntime } from '../../src/core/runtime.js';
import { FakeProvider } from '../support/fake-provider.js';
import type { ResourceBridgeClient } from '../../src/resource/bridge-client.js';
import type { StoredSession } from '../../src/sessions/store.js';

function stored(id: string): StoredSession { return { version: 5, id, createdAt: 'now', updatedAt: 'now', provider: 'fake', model: 'fake-model', workspaceKey: 'workspace', messages: [], journal: { version: 1, turns: [] }, skillCatalog: { version: 1, entries: [] } }; }
function makeFactory(resourceEnabled: boolean, bridgeAvailable = true) {
  const runtime = new IslaRuntime().use({ name: 'fake', setup: context => context.registerProvider(new FakeProvider([{ text: 'ok' }])) });
  return createSessionFactory({ runtime, config: { provider: 'fake', model: 'fake-model', maxContextTurns: 8, maxContextChars: 20_000, contextRetainTurns: 4, maxContextTokens: 8_000, maxOutputTokens: 1_000, contextReserveTokens: 1_000, modelRetries: 0, capabilityPolicy: { resourceEnabled } }, sessionStore: {} as never, workspaceRoot: process.cwd(), resourceBridge: { isAvailable: bridgeAvailable, unavailableReason: 'RESOURCE_UNAVAILABLE' } as ResourceBridgeClient });
}

describe('Resource capability wiring', () => {
  it('reports disabled and unavailable states without exposing Resource tools', () => {
    const disabled = makeFactory(false);
    expect(disabled.capabilitySnapshot().entries.find(entry => entry.id === 'resource')).toMatchObject({ available: false, modelVisible: false, diagnosticCode: 'CAPABILITY_DENIED' });
    expect(disabled.capabilityCatalog().list().some(entry => entry.manifest.id === 'builtin.resource')).toBe(false);
    const unavailable = makeFactory(true, false);
    expect(unavailable.capabilitySnapshot().entries.find(entry => entry.id === 'resource')).toMatchObject({ available: false, diagnosticCode: 'RESOURCE_UNAVAILABLE' });
  });

  it('registers only the six Resource tools under the Resource capability', async () => {
    const factory = makeFactory(true);
    expect(factory.capabilityCatalog().list().find(entry => entry.manifest.id === 'builtin.resource')?.manifest.risk).toBe('external-side-effect');
    const session = factory.create({ stored: stored('resource-session'), interactive: false, resourceTurnId: 'stable-turn' });
    const resolve = (session as unknown as { resolveCapabilities: (input: string, step: number, signal: AbortSignal) => Promise<readonly { id: string; tools: readonly { definition: { name: string } }[] }[]> }).resolveCapabilities;
    const capabilities = await resolve('请检查一下 Resource 下载任务', 0, new AbortController().signal);
    const resource = capabilities.find(item => item.id === 'resource');
    expect(resource?.tools.map(tool => tool.definition.name)).toEqual(['resource_job_create', 'resource_job_get', 'resource_job_list', 'resource_job_cancel', 'resource_job_respond', 'resource_artifact_get']);
  });
});
