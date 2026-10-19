export interface ResourceRuleParseResultV1 {
  readonly shareUrls: readonly string[];
  readonly shareCodeCandidates: readonly string[];
  readonly archivePasswordCandidates: readonly string[];
  readonly titleCandidates: readonly string[];
  readonly warnings: readonly string[];
}

const BAIDU_URL = /https?:\/\/pan\.baidu\.com\/(?:s\/[A-Za-z0-9_-]+|share\/init\?surl=[A-Za-z0-9_-]+)(?:[?&][A-Za-z0-9_=%-]*)*/giu;
const SHARE_CODE = /(?:提取码|分享码|提取码为|分享码为|密码为|code)\s*[:：=]?\s*([A-Za-z0-9]{4})/giu;
const PASSWORD = /(?:解压密码|压缩密码|密码|password|pass)\s*[:：=]?\s*([^\r\n]{1,256})/giu;

export function parseResourceShareText(text: string): ResourceRuleParseResultV1 {
  if (typeof text !== "string" || !text.trim()) throw new Error("RESOURCE_INPUT_REQUIRED");
  if (text.length > 20_000) throw new Error("REQUEST_TOO_LARGE");
  const shareUrls = unique([...text.matchAll(BAIDU_URL)].map(match => match[0]));
  const shareCodeCandidates = unique([...text.matchAll(SHARE_CODE)].map(match => match[1]!));
  const archivePasswordCandidates = unique([...text.matchAll(PASSWORD)].flatMap(match => match[1]!.split(/[\s,，;；|/]+/u)).filter(value => !shareCodeCandidates.includes(value)));
  const titleCandidates = text.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length >= 2 && line.length <= 256 && !/https?:\/\/pan\.baidu\.com\//iu.test(line) && !/^(?:提取码|分享码|解压密码|压缩密码|密码|password|pass)/iu.test(line)).slice(0, 8);
  BAIDU_URL.lastIndex = 0;
  const warnings: string[] = [];
  if (shareUrls.length === 0) warnings.push("未识别到百度网盘分享链接");
  if (shareUrls.length > 1) warnings.push("识别到多个分享链接，需要确认处理顺序");
  return { shareUrls, shareCodeCandidates, archivePasswordCandidates, titleCandidates: unique(titleCandidates), warnings };
}

export function splitResourceShareText(text: string): readonly string[] {
  if (typeof text !== "string" || !text.trim()) throw new Error("RESOURCE_INPUT_REQUIRED");
  if (text.length > 20_000) throw new Error("REQUEST_TOO_LARGE");
  const paragraphs = text.split(/(?:\r?\n){2,}/u).map(value => value.trim()).filter(Boolean);
  const batches: string[] = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
    const urlLines = lines.map((line, index) => { BAIDU_URL.lastIndex = 0; return { index, hasUrl: BAIDU_URL.test(line) }; });
    BAIDU_URL.lastIndex = 0;
    const starts = urlLines.filter(item => item.hasUrl).map(item => item.index);
    if (starts.length <= 1) { if (starts.length === 1) batches.push(lines.join("\n")); continue; }
    const prefix = lines.slice(0, starts[0]);
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]!; const end = starts[index + 1] ?? lines.length;
      batches.push([...(index === 0 ? prefix : []), ...lines.slice(start, end)].join("\n"));
    }
  }
  return batches;
}

function unique(values: readonly string[]): string[] { return [...new Set(values.map(value => value.trim()).filter(Boolean))]; }
