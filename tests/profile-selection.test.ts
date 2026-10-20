import { describe, expect, it } from "vitest";
import type { IslaConfigFileV1 } from "../src/config.js";
import { resolveProfile, resolveWorkerProfile } from "../src/profile-selection.js";

function config(options: { readonly defaultProfile?: string; readonly workerProfile?: string } = {}): IslaConfigFileV1 {
  return {
    version: 1,
    ...options,
    profiles: {
      main: { provider: "local", model: "main-model", baseURL: "http://localhost:11434/v1" },
      worker: { provider: "local", model: "worker-model", baseURL: "http://localhost:11435/v1" },
    },
  };
}

describe("profile selection", () => {
  it("prefers an explicit primary profile over the configured default", () => {
    expect(resolveProfile(config({ defaultProfile: "main" }), "worker")).toMatchObject({ name: "worker", profile: { model: "worker-model" } });
  });

  it("uses the default or the only profile without changing profile data", () => {
    expect(resolveProfile(config({ defaultProfile: "main" }))).toMatchObject({ name: "main", profile: { model: "main-model" } });
    const only: IslaConfigFileV1 = { version: 1, profiles: { local: { provider: "local", model: "only", baseURL: "http://localhost:11434/v1" } } };
    expect(resolveProfile(only)).toEqual({ name: "local", profile: only.profiles.local });
  });

  it("requires an explicit selection for ambiguous configs and rejects missing names", () => {
    expect(() => resolveProfile(config())).toThrow("explicit profile");
    expect(() => resolveProfile(config(), "missing")).toThrow("Isla profile not found: missing");
  });

  it("selects only the configured worker profile and never falls back to primary", () => {
    expect(resolveWorkerProfile(config({ defaultProfile: "main" }))).toBeUndefined();
    expect(resolveWorkerProfile(config({ defaultProfile: "main", workerProfile: "worker" }))).toMatchObject({ name: "worker", profile: { model: "worker-model" } });
  });
});
