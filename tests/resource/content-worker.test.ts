import { describe, expect, it } from "vitest";
import { buildContentManifest, adviseContent } from "../../src/resource/content-worker.js";

describe("content worker boundary", () => {
  it("keeps only bounded relative manifest entries", () => {
    const manifest = buildContentManifest([{ relativePath: "../secret", kind: "file" }, { relativePath: "folder/file.mp4", kind: "file", sizeBytes: 4 }]);
    expect(manifest.entries).toEqual([{ relativePath: "folder/file.mp4", kind: "file", sizeBytes: 4 }]);
  });
  it("degrades to no advice when Worker is unavailable", async () => {
    await expect(adviseContent(undefined, buildContentManifest([{ relativePath: "folder", kind: "directory" }]))).resolves.toBeUndefined();
  });
});
