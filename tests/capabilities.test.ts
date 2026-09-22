import { describe, expect, it } from 'vitest';
import { composeCapabilitySnapshot } from '../src/capabilities.js';

describe('capability composition', () => {
  const capability = { id: 'mcp:research', instructions: 'untrusted', tools: [{ definition: { name: 'mcp__research__read', description: 'read', parameters: { type: 'object' } }, execute: async () => 'ok' }] };

  it('projects stable entries and hides denied MCP tools', () => {
    const snapshot = composeCapabilitySnapshot([capability], [], { mcpServerDeny: ['research'] });
    expect(snapshot.entries[0]).toMatchObject({ id: 'mcp__research__read', kind: 'mcp-tool', modelVisible: false });
    expect(snapshot.toolDefinitions).toHaveLength(0);
    expect(snapshot.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('applies tool and skill budgets without truncating a schema', () => {
    const snapshot = composeCapabilitySnapshot([capability], [{ name: 'docs', description: 'a skill', source: 'workspace', modelInvocable: true, userInvocable: true }], { maxTools: 0, maxSkillDescriptionChars: 3 });
    expect(snapshot.entries.find(entry => entry.id === 'mcp__research__read')).toMatchObject({ modelVisible: false, diagnosticCode: 'CAPABILITY_BUDGET_EXCEEDED' });
    expect(snapshot.entries.find(entry => entry.id === 'skill:docs')).toMatchObject({ modelVisible: false, diagnosticCode: 'CAPABILITY_BUDGET_EXCEEDED' });
  });
});
