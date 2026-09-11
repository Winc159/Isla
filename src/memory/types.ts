export type MemoryScope = "global" | "workspace";
export type MemoryKind = "preference" | "constraint" | "fact" | "decision" | "goal";
export type MemoryStatus = "active" | "candidate" | "superseded" | "disabled";
export type MemoryProvenance = "explicit-user" | "verified-tool" | "inferred";

export interface MemorySourceInput {
  readonly type: "session" | "workspace" | "manual" | "external";
  readonly sessionId?: string;
  readonly messageIndex?: number;
  readonly locator?: string;
}

export type CoreMemoryBlockName = "persona" | "user" | "workspace";
export interface CoreMemoryBlock { readonly name: CoreMemoryBlockName; readonly content: string; readonly budget: number; readonly updatedAt: string; }

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly workspace?: string;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly status: MemoryStatus;
  readonly provenance: MemoryProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly source?: MemorySourceInput;
}

export interface CreateMemoryInput {
  readonly id?: string;
  readonly scope: MemoryScope;
  readonly workspace?: string;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly status?: MemoryStatus;
  readonly provenance: MemoryProvenance;
  readonly source?: MemorySourceInput;
}

export interface UpdateMemoryInput {
  readonly content?: string;
  readonly status?: MemoryStatus;
  readonly provenance?: MemoryProvenance;
  readonly source?: MemorySourceInput;
  readonly expectedRevision: number;
}

export interface MemoryRevision {
  readonly id: string;
  readonly memoryId: string;
  readonly revision: number;
  readonly action: "created" | "updated" | "disabled" | "restored";
  readonly before?: MemoryRecord;
  readonly after: MemoryRecord;
  readonly createdAt: string;
}

export type SearchTargetType = "memory" | "conversation";
export interface SearchDocument {
  readonly targetType: SearchTargetType;
  readonly targetId: string;
  readonly scope: MemoryScope;
  readonly workspace?: string;
  readonly status: MemoryStatus | "archived";
  readonly content: string;
  readonly normalizedContent: string;
  readonly source?: MemorySourceInput;
  readonly updatedAt: string;
}

export interface SearchResult extends SearchDocument { readonly score: number; }
