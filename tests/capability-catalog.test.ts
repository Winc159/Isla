import { describe, expect, it } from 'vitest';
import { CapabilityCatalog, createCapabilityProvider, type CapabilityProvider } from '../src/capability-catalog.js';

function provider(id: string, description: string, keywords: readonly string[] = []): CapabilityProvider {
  return {
    manifest: {
      id,
      version: '1.0.0',
      description,
      keywords,
      toolSummaries: [{ name: `${id}_action`, description }],
      activation: 'lazy',
      lifetime: 'task',
      requirements: {},
      risk: 'read',
    },
    status: () => ({ state: 'available' }),
    activate: async () => ({ id, instructions: description, tools: [] }),
  };
}

describe('CapabilityCatalog', () => {
  it('registers providers and lists entries in stable id order', () => {
    const catalog = new CapabilityCatalog();
    catalog.register(provider('builtin.web', 'Public web access', ['web', 'fetch']));
    catalog.register(provider('builtin.browser', 'Interactive browser access', ['browser', 'web']));

    expect(catalog.list().map(entry => entry.manifest.id)).toEqual(['builtin.browser', 'builtin.web']);
    expect(catalog.get('builtin.web')).toMatchObject({ availability: { state: 'available' } });
  });

  it('searches summaries without exposing provider execution details', () => {
    const catalog = new CapabilityCatalog();
    catalog.register(provider('builtin.web', 'Fetch public web pages', ['web', 'fetch']));
    catalog.register(provider('builtin.project', 'Read project files', ['workspace', 'files']));

    const result = catalog.search('read files');
    expect(result.map(entry => entry.manifest.id)).toEqual(['builtin.project']);
    expect(result[0]).not.toHaveProperty('provider');
    expect(result[0]).not.toHaveProperty('toolDefinitions');
  });

  it('rejects duplicate ids and invalid manifests', () => {
    const catalog = new CapabilityCatalog();
    catalog.register(provider('builtin.web', 'Public web access'));
    expect(() => catalog.register(provider('builtin.web', 'Duplicate'))).toThrow('CAPABILITY_DUPLICATE_ID');
    expect(() => catalog.register(provider('bad id', 'Invalid id'))).toThrow('CAPABILITY_MANIFEST_INVALID_ID');
  });

  it('bounds search result count and rejects duplicate tool summaries', () => {
    const invalid = provider('builtin.invalid', 'Invalid summaries');
    const duplicate = { ...invalid, manifest: { ...invalid.manifest, toolSummaries: [{ name: 'same', description: 'one' }, { name: 'same', description: 'two' }] } };
    expect(() => new CapabilityCatalog().register(duplicate)).toThrow('CAPABILITY_MANIFEST_INVALID_TOOLS');
    expect(() => new CapabilityCatalog().search('anything', 33)).toThrow('CAPABILITY_SEARCH_LIMIT_INVALID');
  });

  it('bridges an existing capability with a stable id and policy-aware availability', () => {
    const capability = { id: 'mcp:research', instructions: 'Read research data', tools: [{ definition: { name: 'mcp__research__read', description: 'read', parameters: { type: 'object' } }, execute: async () => 'ok' }] };
    const provider = createCapabilityProvider(capability, { policy: { mcpServerDeny: ['research'] } });

    expect(provider.manifest.id).toBe('mcp.research');
    expect(provider.manifest.toolSummaries[0]).toMatchObject({ name: 'mcp__research__read' });
    expect(provider.status({ providerId: provider.manifest.id })).toMatchObject({ state: 'denied', reasonCode: 'CAPABILITY_DENIED' });
  });

  it('filters denied MCP tools again at activation time', async () => {
    const capability = { id: 'mcp:research', instructions: 'Read research data', tools: [
      { definition: { name: 'mcp__research__safe', description: 'safe', parameters: { type: 'object' } }, execute: async () => 'safe' },
      { definition: { name: 'mcp__research__secret', description: 'secret', parameters: { type: 'object' } }, execute: async () => 'secret' },
    ] };
    const provider = createCapabilityProvider(capability, { policy: { mcpToolDeny: ['mcp__research__secret'] } });
    const activated = await provider.activate({ providerId: provider.manifest.id });
    expect(activated.tools.map(tool => tool.definition.name)).toEqual(['mcp__research__safe']);
    expect(provider.manifest.toolSummaries.map(tool => tool.name)).toEqual(['mcp__research__safe']);
  });
});
