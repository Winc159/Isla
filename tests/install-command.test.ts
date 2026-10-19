import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("unified install entry", () => {
  it("keeps the install orchestration outside Runtime startup", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "install-all.mjs"), "utf8");
    expect(source).toContain("install-dependencies.mjs");
    expect(source).toContain("install-bdpan.mjs");
  });
});
