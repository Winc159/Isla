declare module "turndown" {
  interface TurndownOptions { readonly headingStyle?: "setext" | "atx"; readonly codeBlockStyle?: "indented" | "fenced"; }
  export default class TurndownService {
    constructor(options?: TurndownOptions);
    addRule(key: string, rule: unknown): this;
    use(plugin: (service: TurndownService) => void): this;
    turndown(html: string): string;
  }
}

declare module "turndown-plugin-gfm" {
  export function gfm(service: import("turndown").default): void;
}
