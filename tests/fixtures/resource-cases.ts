export interface ResourceCaseFixture {
  readonly id: string;
  readonly shareText: string;
  readonly expected: {
    readonly hasShareCode: boolean;
    readonly passwordCount: number;
    readonly archiveCase: "ordinary" | "renamed" | "mp4-appended-rar" | "multi-volume" | "rar5";
  };
}

export const RESOURCE_CASE_FIXTURES: readonly ResourceCaseFixture[] = [
  { id: "ordinary", shareText: "链接：https://pan.baidu.com/s/fixture-normal 解压密码：demo-pass", expected: { hasShareCode: false, passwordCount: 1, archiveCase: "ordinary" } },
  { id: "share-code", shareText: "百度链接 https://pan.baidu.com/s/fixture-code 提取码 ab12 密码 safe-demo", expected: { hasShareCode: true, passwordCount: 1, archiveCase: "ordinary" } },
  { id: "password-candidates", shareText: "https://pan.baidu.com/s/fixture-password 提取码 cd34 可能密码：first / second / third", expected: { hasShareCode: true, passwordCount: 3, archiveCase: "ordinary" } },
  { id: "renamed-archive", shareText: "https://pan.baidu.com/s/fixture-renamed 文件后缀被修改，请按内容识别", expected: { hasShareCode: false, passwordCount: 0, archiveCase: "renamed" } },
  { id: "mp4-appended-rar", shareText: "https://pan.baidu.com/s/fixture-appended 下载的 MP4 尾部包含 RAR", expected: { hasShareCode: false, passwordCount: 0, archiveCase: "mp4-appended-rar" } },
  { id: "multi-volume", shareText: "https://pan.baidu.com/s/fixture-volumes 内容为 part1.rar 至 part3.rar", expected: { hasShareCode: false, passwordCount: 0, archiveCase: "multi-volume" } },
  { id: "rar5", shareText: "https://pan.baidu.com/s/fixture-rar5 内容使用 RAR5", expected: { hasShareCode: false, passwordCount: 0, archiveCase: "rar5" } },
] as const;
