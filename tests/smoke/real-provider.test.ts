import { describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { ConfigStore, defaultConfigPath } from "../../src/config/store.js";
import { profileToAppConfig, resolveProfile } from "../../src/config/schema.js";
import { createRuntime } from "../../src/runtime/bootstrap.js";

const enabled = process.env.ISLA_RUN_REAL_SMOKE === "1";

describe.skipIf(!enabled)("real Profile provider smoke", () => {
  it("answers two independent prompts using the selected default Profile", async () => {
    const loaded = await new ConfigStore(defaultConfigPath()).load();
    if (loaded.status !== "ready") throw new Error(`DEFAULT_PROFILE_CONFIG_UNAVAILABLE:${loaded.status}`);
    const selected = resolveProfile(loaded.config);
    const config = profileToAppConfig(selected.profile);
    const provider = createRuntime(config).getProvider(config.provider);
    if (!provider) throw new Error(`PROFILE_PROVIDER_UNAVAILABLE:${config.provider}`);
    process.stdout.write(`[real-smoke] profile=${selected.name} provider=${config.provider} model=${config.model}\n`);
    const session = new ChatSession(provider, { enableTools: false, agentLoop: false });
    try {
      const first = await session.send("Reply with the single word: ready");
      const second = await session.send("Reply with the single word: second");
      expect(first.text.trim()).toBeTruthy();
      expect(second.text.trim()).toBeTruthy();
    } finally {
      await session.close();
    }
  }, 90_000);
});
