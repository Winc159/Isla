/// <reference types="node" />

import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { writeModelPreview } from '../../src/cli/models-command.js';

describe('/models output', () => {
  it('limits the default preview to ten models and points to TTY browsing', () => {
    let text = '';
    const output = new Writable({ write(chunk, _encoding, callback) { text += chunk.toString(); callback(); } });
    const models = Array.from({ length: 12 }, (_, index) => ({ id: `model-${index + 1}`, capabilities: [], features: [] }));

    writeModelPreview(output, models);

    expect(text).toContain('model-10');
    expect(text).not.toContain('model-11\n');
    expect(text).toContain('还有 2 个模型，输入 /models browse 进入 TTY 浏览全部。');
    expect(text).toContain('切换模型：/models use <model-id>（下次启动生效）');
  });
});
