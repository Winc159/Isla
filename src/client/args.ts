export interface CliStartupArgs {
  readonly profileName?: string;
  readonly configPath?: string;
  readonly useEnv: boolean;
  readonly protocol?: string;
  readonly workspacePath?: string;
  readonly models?: boolean;
}

export function parseCliStartupArgs(argv: readonly string[]): CliStartupArgs {
  let profileName: string | undefined;
  let configPath: string | undefined;
  let protocol: string | undefined;
  let useEnv = false;
  let workspacePath: string | undefined;
  let models = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env') { useEnv = true; continue; }
    if (arg === '--models') { models = true; continue; }
    if (arg === '--profile' || arg === '--config' || arg === '--protocol' || arg === '--workspace') {
      const value = argv[++index];
      if (!value?.trim()) throw new Error(`${arg} requires a value`);
      if (arg === '--profile') profileName = value;
      else if (arg === '--config') configPath = value;
      else if (arg === '--protocol') protocol = value;
      else workspacePath = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (useEnv && (profileName || configPath)) throw new Error('--env cannot be combined with --profile or --config');
  return { ...(profileName ? { profileName } : {}), ...(configPath ? { configPath } : {}), useEnv, ...(protocol ? { protocol } : {}), ...(workspacePath ? { workspacePath } : {}), ...(models ? { models: true } : {}) };
}
