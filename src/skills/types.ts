export type SkillSource = "workspace" | "personal";

export interface SkillInvocationPolicy {
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
}

export interface SkillCatalogEntry extends SkillInvocationPolicy {
  readonly name: string;
  readonly description: string;
  readonly source: SkillSource;
}

export interface SkillDefinition extends SkillCatalogEntry {
  readonly content: string;
  readonly resourceDirectory: string;
}

export type SkillDiagnosticCode =
  | "SKILL_INVALID"
  | "SKILL_INVALID_NAME"
  | "SKILL_TOO_LARGE"
  | "SKILL_READ_FAILED";

export interface SkillDiagnostic {
  readonly code: SkillDiagnosticCode;
  readonly name?: string;
}

export interface SkillCatalogOptions {
  readonly maxDescriptionChars?: number;
  readonly maxBodyChars?: number;
  readonly maxSkillCount?: number;
  readonly signal?: AbortSignal;
}
