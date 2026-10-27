import { describe, expect, it } from 'vitest';
import { buildContainerInvocation } from '../../src/tools/container-adapter.js';

const image = `registry.example.test/isla@sha256:${'b'.repeat(64)}`;

describe('container execution adapter', () => {
  it('pins the image, disables networking and exposes only the workspace', () => {
    const invocation = buildContainerInvocation({ engine: 'podman', image, workspaceRoot: 'D:/workspace/project', workdir: 'D:/workspace/project/src', executable: 'node', argv: ['--version'] });
    expect(invocation).toMatchObject({ executable: 'podman', cwd: expect.any(String) });
    expect(invocation.argv).toContain('--pull=never');
    expect(invocation.argv).toContain('--network=none');
    expect(invocation.argv).toContain('--read-only');
    expect(invocation.argv).toContain('--cap-drop=ALL');
    expect(invocation.argv).toContain('--security-opt=no-new-privileges');
    expect(invocation.argv).toContain('/workspace/src');
    expect(invocation.argv.at(-3)).toBe(image);
    expect(invocation.argv.slice(-2)).toEqual(['node', '--version']);
  });

  it('rejects mutable images, workspace escape, and ambiguous mount paths', () => {
    expect(() => buildContainerInvocation({ engine: 'docker', image: 'node:latest', workspaceRoot: 'D:/project', workdir: 'D:/project', executable: 'node', argv: [] })).toThrow('CONTAINER_IMAGE_MUST_BE_DIGEST_PINNED');
    expect(() => buildContainerInvocation({ engine: 'docker', image, workspaceRoot: 'D:/project', workdir: 'D:/outside', executable: 'node', argv: [] })).toThrow('WORKDIR_INVALID');
    expect(() => buildContainerInvocation({ engine: 'docker', image, workspaceRoot: 'D:/project,other', workdir: 'D:/project,other', executable: 'node', argv: [] })).toThrow('CONTAINER_WORKSPACE_PATH_UNSUPPORTED');
  });
});
