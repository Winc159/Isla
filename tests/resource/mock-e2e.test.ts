import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrateResourceDatabase } from "../../src/resource/database-schema.js";
import { parseResourceShareText } from "../../src/resource/parser.js";
import { ResourceScheduler } from "../../src/resource/scheduler.js";

describe("Resource mock download path", () => {
  it("runs parse -> confirm-shaped input -> concurrent mock download -> output", async () => {
    const root = mkdtempSync(join(tmpdir(), "isla-resource-mock-")); const db = new DatabaseSync(":memory:"); migrateResourceDatabase(db);
    const scheduler = new ResourceScheduler(db, { concurrency: { download: 2, inspection: 1, extraction: 1, inference: 1 } });
    try {
      const parsed = parseResourceShareText("标题\nhttps://pan.baidu.com/s/mock-one 密码: demo-one");
      expect(parsed.shareUrls).toHaveLength(1);
      for (const id of ["mock-one", "mock-two"]) db.prepare("INSERT INTO resource_jobs (id, version, revision, source, status, stage, destination_root_id, input_json, progress_json, created_at, updated_at) VALUES (?, 1, 1, 'baidu', 'queued', 'queued_download', 'library', '{}', '{}', 'now', 'now')").run(id);
      const download = (name: string) => scheduler.enqueue(`mock-${name}`, "download", async () => { const output = join(root, name, "content.txt"); const folder = join(root, name); const { mkdirSync, writeFileSync } = await import("node:fs"); mkdirSync(folder, { recursive: true }); writeFileSync(output, `mock complete: ${name}\n`, "utf8"); return output; });
      const first = download("one"); const second = download("two");
      const outputs = await Promise.all([first.promise, second.promise]);
      expect(outputs.map(path => readFileSync(path, "utf8"))).toEqual(["mock complete: one\n", "mock complete: two\n"]);
    } finally { await scheduler.stop(); db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
