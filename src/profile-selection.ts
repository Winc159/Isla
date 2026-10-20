import type { IslaConfigFileV1, StartupProfileV1 } from "./config.js";

export interface ResolvedProfile {
  readonly name: string;
  readonly profile: StartupProfileV1;
}

export function resolveProfile(file: IslaConfigFileV1, name?: string): ResolvedProfile {
  const profileNames = Object.keys(file.profiles);
  const selected = name ?? file.defaultProfile ?? (profileNames.length === 1 ? profileNames[0] : undefined);
  if (!selected) throw new Error("Isla config requires an explicit profile");
  const profile = file.profiles[selected];
  if (!profile) throw new Error(`Isla profile not found: ${selected}`);
  return { name: selected, profile };
}

export function resolveWorkerProfile(file: IslaConfigFileV1): ResolvedProfile | undefined {
  if (!file.workerProfile) return undefined;
  return { name: file.workerProfile, profile: file.profiles[file.workerProfile]! };
}
