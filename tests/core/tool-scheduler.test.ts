import { describe, expect, it } from 'vitest';
import { scheduleToolCalls } from '../../src/core/tool-scheduler.js';

const calls = [{ id: 'a', name: 'read', arguments: '{}' }, { id: 'b', name: 'read', arguments: '{}' }, { id: 'c', name: 'write', arguments: '{}' }];

describe('tool scheduler', () => {
  it('is serially equivalent at parallelism one', async () => {
    const order: string[] = [];
    const result = await scheduleToolCalls(calls, { parallelism: 1, execute: async call => { order.push(call.id); return call.id; } });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(result.map(item => item.result)).toEqual(['a', 'b', 'c']);
  });
  it('runs safe calls in bounded waves and commits source order', async () => {
    let running = 0; let peak = 0;
    const result = await scheduleToolCalls(calls, { parallelism: 2, isParallelSafe: call => call.name === 'read', execute: async call => { running += 1; peak = Math.max(peak, running); await new Promise(resolve => setTimeout(resolve, call.id === 'a' ? 15 : 2)); running -= 1; return call.id; } });
    expect(peak).toBe(2);
    expect(result.map(item => item.result)).toEqual(['a', 'b', 'c']);
  });
  it('rejects invalid parallelism', async () => {
    await expect(scheduleToolCalls([], { parallelism: 0, execute: async () => 'x' })).rejects.toThrow('TOOL_PARALLELISM_INVALID');
  });
  it('drains the active wave before surfacing a failure', async () => {
    const completed: string[] = [];
    await expect(scheduleToolCalls(calls, { parallelism: 2, isParallelSafe: () => true, execute: async call => { await new Promise(resolve => setTimeout(resolve, call.id === 'a' ? 10 : 1)); completed.push(call.id); if (call.id === 'b') throw new Error('boom'); return call.id; } })).rejects.toThrow('boom');
    expect(completed.sort()).toEqual(['a', 'b']);
  });
  it('does not dispatch a later wave after cancellation', async () => {
    const controller = new AbortController(); const started: string[] = [];
    await expect(scheduleToolCalls(calls, { parallelism: 2, isParallelSafe: () => true, signal: controller.signal, execute: async call => { started.push(call.id); if (call.id === 'b') controller.abort(); return call.id; } })).rejects.toThrow('TOOL_SCHEDULER_ABORTED');
    expect(started).toEqual(['a', 'b']);
  });
});
