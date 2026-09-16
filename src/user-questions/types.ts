export interface UserQuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface UserQuestion {
  readonly id: string;
  readonly question: string;
  readonly header?: string;
  readonly options?: readonly UserQuestionOption[];
  readonly multiSelect?: boolean;
}

export interface UserQuestionAnswer {
  readonly id: string;
  readonly selected: readonly string[];
  readonly custom?: string;
}

export interface UserQuestionRequest { readonly questions: readonly UserQuestion[]; }
export interface UserQuestionResult { readonly answers: readonly UserQuestionAnswer[]; }
export interface UserQuestionService {
  ask(request: UserQuestionRequest, options?: { readonly signal?: AbortSignal }): Promise<UserQuestionResult>;
}
