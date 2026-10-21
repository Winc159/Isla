export interface ScheduledToolCall { readonly id: string; readonly name: string; readonly arguments: string; }
export interface ToolScheduleResult<T> { readonly call: ScheduledToolCall; readonly result: T; }

export interface ToolSchedulerOptions<T> {
  readonly parallelism: number;
  readonly execute: (call: ScheduledToolCall, index: number) => Promise<T>;
  readonly isParallelSafe?: (call: ScheduledToolCall) => boolean;
  readonly signal?: AbortSignal;
}

const EXPLICIT_PARALLEL_SAFE = new Set(['read_text_file', 'list_directory', 'project_search', 'web_search']);
export function isParallelSafeTool(name: string): boolean { return EXPLICIT_PARALLEL_SAFE.has(name); }

/** Executes safe calls in bounded waves, but always returns results in source order. */
export async function scheduleToolCalls<T>(calls: readonly ScheduledToolCall[], options: ToolSchedulerOptions<T>): Promise<readonly ToolScheduleResult<T>[]> {
  if (!Number.isInteger(options.parallelism) || options.parallelism < 1 || options.parallelism > 8) throw new Error('TOOL_PARALLELISM_INVALID');
  const results: ToolScheduleResult<T>[] = [];
  let index = 0;
  while (index < calls.length) {
    if (options.signal?.aborted) throw new Error('TOOL_SCHEDULER_ABORTED');
    const wave: { call: ScheduledToolCall; index: number }[] = [];
    while (index < calls.length && wave.length < options.parallelism) {
      const call = calls[index]!;
      if (wave.length > 0 && options.isParallelSafe && !options.isParallelSafe(call)) break;
      wave.push({ call, index }); index += 1;
      if (!options.isParallelSafe?.(call)) break;
    }
    const settled = await Promise.allSettled(wave.map(item => options.execute(item.call, item.index).then(result => ({ call: item.call, index: item.index, result }))));
    const failure = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
    if (failure) throw failure.reason;
    const completed = settled.filter((item): item is PromiseFulfilledResult<{ call: ScheduledToolCall; index: number; result: T }> => item.status === 'fulfilled').map(item => item.value);
    for (const item of completed.sort((a, b) => a.index - b.index)) results.push({ call: item.call, result: item.result });
  }
  return results;
}
