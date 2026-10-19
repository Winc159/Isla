import { describe, expect, it } from "vitest";
import { chooseResourceName } from "../../src/resource/naming.js";

const completedAt = new Date("2026-10-12T02:00:00.000Z");
describe("resource deterministic naming", () => {
  it("prefers explicit and useful rule names without a worker", () => expect(chooseResourceName({ explicitName: " 拆弹专家 ", completedAt })).toMatchObject({ name: "拆弹专家", source: "explicit", needsConfirmation: false }));
  it("uses useful Chinese input before downloaded filenames", () => expect(chooseResourceName({ titleCandidates: ["20261012020000", "电影 拆弹专家"], downloadedNames: ["file.zip"], completedAt })).toMatchObject({ name: "电影 拆弹专家", source: "rules" }));
  it("uses worker only as an optional suggestion", () => expect(chooseResourceName({ workerSuggestion: "推测的课程名称", downloadedNames: ["1740000000000.zip"], completedAt })).toMatchObject({ source: "worker", needsConfirmation: true }));
  it("falls back deterministically when neither rules nor worker help", () => expect(chooseResourceName({ downloadedNames: ["1740000000000.zip"], completedAt })).toEqual({ name: "resource-20261012-020000Z", source: "timestamp", needsConfirmation: true }));
});
