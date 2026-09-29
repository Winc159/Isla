export type BrowserSessionStatus = 'starting' | 'ready' | 'agent_control' | 'user_control' | 'waiting_approval' | 'closed' | 'crashed' | 'unavailable';

export interface BrowserLaunchOptions {
  readonly executablePath?: string;
  readonly userDataDirectory: string;
  readonly headless?: boolean;
  readonly downloadsEnabled?: boolean;
}

export interface BrowserSessionSnapshot {
  readonly id: string;
  readonly status: BrowserSessionStatus;
  readonly tabId?: string;
  readonly documentId?: string;
  readonly snapshotId?: string;
  readonly url?: string;
  readonly title?: string;
}

export interface BrowserAdapter {
  launch(options: BrowserLaunchOptions): Promise<BrowserSessionHandle>;
}

export interface BrowserSessionHandle {
  readonly id: string;
  readonly snapshot: () => Promise<BrowserSessionSnapshot>;
  readonly navigate?: (url: string) => Promise<void>;
  readonly observe?: () => Promise<readonly BrowserElementRef[]>;
  readonly readText?: () => Promise<string>;
  readonly find?: (query: string, maxMatches?: number) => Promise<readonly BrowserElementRef[]>;
  readonly read?: (cursor?: string, maxChars?: number) => Promise<{ readonly text: string; readonly cursor?: string; readonly truncated: boolean }>;
  readonly screenshot?: () => Promise<Buffer>;
  readonly click?: (ref: string) => Promise<void>;
  readonly type?: (ref: string, text: string) => Promise<void>;
  readonly select?: (ref: string, value: string) => Promise<void>;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly scroll?: (deltaY: number) => Promise<void>;
  readonly back?: () => Promise<void>;
  readonly links?: (maxLinks?: number) => Promise<readonly { readonly href: string; readonly text?: string; readonly imageAlt?: string }[]>;
  close(): Promise<void>;
}

export interface BrowserElementRef { readonly ref: string; readonly role: string; readonly text?: string; readonly description?: string; readonly href?: string; readonly inputType?: string; readonly name?: string; readonly disabled?: boolean; readonly tabId?: string; readonly documentId?: string; }
