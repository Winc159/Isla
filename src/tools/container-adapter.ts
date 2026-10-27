import { isAbsolute, relative, resolve } from 'node:path';

export interface ContainerCommandConfig { readonly engine: 'docker' | 'podman'; readonly image: string; }
export interface ContainerCommandRequest extends ContainerCommandConfig {
  readonly workspaceRoot: string;
  readonly workdir: string;
  readonly executable: string;
  readonly argv: readonly string[];
}

export function buildContainerInvocation(request: ContainerCommandRequest): { readonly executable: string; readonly argv: readonly string[]; readonly cwd: string } {
  if (!/^[A-Za-z0-9._/:+-]+@sha256:[a-f0-9]{64}$/iu.test(request.image)) throw new Error('CONTAINER_IMAGE_MUST_BE_DIGEST_PINNED');
  const workspaceRoot = resolve(request.workspaceRoot);
  const workdir = resolve(request.workdir);
  const relativeWorkdir = relative(workspaceRoot, workdir);
  if (relativeWorkdir === '..' || relativeWorkdir.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativeWorkdir)) throw new Error('WORKDIR_INVALID');
  if (workspaceRoot.includes(',')) throw new Error('CONTAINER_WORKSPACE_PATH_UNSUPPORTED');
  const containerWorkdir = relativeWorkdir ? `/workspace/${relativeWorkdir.replaceAll('\\', '/')}` : '/workspace';
  return {
    executable: request.engine,
    cwd: workspaceRoot,
    argv: [
      'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=1g', '--cpus=2',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=64m', '--volume', `${workspaceRoot}:/workspace:rw`,
      '--workdir', containerWorkdir, request.image, request.executable, ...request.argv,
    ],
  };
}
