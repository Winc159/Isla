import { describe, expect, it } from 'vitest';
import type { ElicitRequestFormParams } from '@modelcontextprotocol/client';
import { handleFormElicitation } from '../src/mcp/stdio-client.js';

const request = {
  mode: 'form',
  message: 'Complete the requested operation.',
  requestedSchema: {
    type: 'object',
    properties: {
      destination: { type: 'string', title: 'Destination', minLength: 2 },
      count: { type: 'integer', minimum: 1, maximum: 5 },
      enabled: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string', enum: ['one', 'two'] }, minItems: 1 },
      optional: { type: 'string' },
    },
    required: ['destination', 'count', 'enabled', 'tags'],
  },
} as ElicitRequestFormParams;

describe('MCP Form Elicitation', () => {
  it('maps bounded form fields through the active user-question service without losing enum values', async () => {
    let shownMessage = '';
    const result = await handleFormElicitation(request, { service: {
      ask: async input => {
        shownMessage = input.questions[0]?.question ?? '';
        return { answers: [
          { id: 'mcp-field-0', selected: [], custom: 'Paris' },
          { id: 'mcp-field-1', selected: [], custom: '3' },
          { id: 'mcp-field-2', selected: ['true'] },
          { id: 'mcp-field-3', selected: ['two'] },
          { id: 'mcp-field-4', selected: [], custom: '' },
        ] };
      },
    } });
    expect(shownMessage).toContain('Complete the requested operation.');
    expect(result).toEqual({ action: 'accept', content: { destination: 'Paris', count: 3, enabled: true, tags: ['two'] } });
  });

  it('declines when there is no interactive user service or a required answer is invalid', async () => {
    await expect(handleFormElicitation(request, undefined)).resolves.toEqual({ action: 'decline' });
    await expect(handleFormElicitation(request, { service: { ask: async () => ({ answers: request.requestedSchema.required!.map((_, index) => ({ id: `mcp-field-${index}`, selected: [], custom: '' })) }) } })).resolves.toEqual({ action: 'decline' });
  });

  it('declines unsupported or oversized schemas before asking the user', async () => {
    let asked = false;
    const service = { ask: async () => { asked = true; return { answers: [] }; } };
    const unsupported = { ...request, requestedSchema: { ...request.requestedSchema, properties: { value: { type: 'object' } } } } as ElicitRequestFormParams;
    await expect(handleFormElicitation(unsupported, { service })).resolves.toEqual({ action: 'decline' });
    expect(asked).toBe(false);
  });

  it('supports the legacy form shape and propagates turn cancellation to the question service', async () => {
    const legacy = { ...request, mode: undefined } as unknown as ElicitRequestFormParams;
    const controller = new AbortController();
    const pending = handleFormElicitation(legacy, { service: { ask: async (_input, options) => new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('TURN_CANCELLED')), { once: true })) }, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('TURN_CANCELLED');
  });
});
