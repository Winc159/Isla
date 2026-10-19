import { describe, expect, it } from "vitest";
import { buildExtractionArgs, detectArchiveFormat, detectArchivePart, groupArchiveParts, inspectArchive, normalizeArchiveName } from "../../src/resource/archive.js";

const bytes = (...values: number[]) => Uint8Array.from(values);
describe("archive inspection", () => {
  it("recognizes archives even after extension changes", () => {
    expect(inspectArchive("中文电影.final.mp4", bytes(0x50, 0x4b, 0x03, 0x04)).format).toBe("zip");
    expect(inspectArchive("中文电影.final.mp4", bytes(0x50, 0x4b, 0x03, 0x04)).isArchive).toBe(true);
  });
  it("keeps useful Chinese names while removing volume suffixes", () => {
    const part = detectArchivePart("课程资料.001");
    expect(part?.index).toBe(1);
    expect(normalizeArchiveName("课程资料.001", "zip", part)).toBe("课程资料.zip");
  });
  it("recognizes RAR4/RAR5, 7z, media and nested archive signatures", () => {
    expect(detectArchiveFormat(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00))).toBe("rar4");
    expect(detectArchiveFormat(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00))).toBe("rar5");
    expect(detectArchiveFormat(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c))).toBe("7z");
    expect(inspectArchive("video.mp4", bytes(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70)).likelyMedia).toBe(true);
    expect(detectArchiveFormat(bytes(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 1, 2, 0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00))).toBe("rar5");
  });
  it("groups numbered volumes without exposing internal ids", () => expect(groupArchiveParts(["课程.001", "课程.002", "课程.003"])[0]?.map(item => item.index)).toEqual([1, 2, 3]));
  it("builds a deterministic safe extraction command", () => expect(buildExtractionArgs("a.pkg", "out", "pass")).toEqual(["x", "a.pkg", "-oout", "-y", "-ppass"]));
});
