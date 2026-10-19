import { describe, expect, it } from "vitest";
import { parseResourceShareText, splitResourceShareText } from "../../src/resource/parser.js";

describe("Resource share text parser", () => {
  it("supports share/init links without worker assistance", () => expect(parseResourceShareText("https://pan.baidu.com/share/init?surl=23Td0c3mJFWFq4cHI-dmjA\n分享码 ddys\n拆弹专家电影")).toMatchObject({ shareUrls: ["https://pan.baidu.com/share/init?surl=23Td0c3mJFWFq4cHI-dmjA"], shareCodeCandidates: ["ddys"], titleCandidates: ["拆弹专家电影"] }));
  it("extracts link, share code and archive passwords in order", () => {
    const result = parseResourceShareText("课程资料\nhttps://pan.baidu.com/s/fixture_01 提取码: ab12\n解压密码：first / second");
    expect(result.shareUrls).toEqual(["https://pan.baidu.com/s/fixture_01"]);
    expect(result.shareCodeCandidates).toEqual(["ab12"]);
    expect(result.archivePasswordCandidates).toEqual(["first", "second"]);
  });

  it("deduplicates multiple links and reports ambiguity", () => {
    const result = parseResourceShareText("https://pan.baidu.com/s/a\nhttps://pan.baidu.com/s/a\nhttps://pan.baidu.com/s/b");
    expect(result.shareUrls).toHaveLength(2);
    expect(result.warnings).toContain("识别到多个分享链接，需要确认处理顺序");
  });

  it("rejects missing links and oversized input", () => {
    expect(parseResourceShareText("没有链接").warnings).toContain("未识别到百度网盘分享链接");
    expect(parseResourceShareText("https://pan.baidu.com/s/链接里有汉字").warnings).toContain("未识别到百度网盘分享链接");
    expect(() => parseResourceShareText("x".repeat(20_001))).toThrow("REQUEST_TOO_LARGE");
  });

  it("splits pasted resource blocks into independent single-link jobs", () => {
    const result = splitResourceShareText("课程 A\nhttps://pan.baidu.com/s/a 提取码 aa11\n\n课程 B\nhttps://pan.baidu.com/s/b\n分享码 bb22\n\n说明文字");
    expect(result).toEqual(["课程 A\nhttps://pan.baidu.com/s/a 提取码 aa11", "课程 B\nhttps://pan.baidu.com/s/b\n分享码 bb22"]);
    expect(result.map(item => parseResourceShareText(item).shareUrls)).toEqual([["https://pan.baidu.com/s/a"], ["https://pan.baidu.com/s/b"]]);
  });

  it("splits adjacent link lines when the user did not add blank separators", () => {
    expect(splitResourceShareText("合集\nhttps://pan.baidu.com/s/a\nhttps://pan.baidu.com/s/b")).toEqual(["合集\nhttps://pan.baidu.com/s/a", "https://pan.baidu.com/s/b"]);
  });
});
