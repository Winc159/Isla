import type { SessionJournal, TurnActionRecord } from "./journal.js";

export type VerificationStatus = "not_applicable" | "not_run" | "passed_after_last_change" | "failed_after_last_change";

export function deriveVerificationStatus(journal: SessionJournal): VerificationStatus {
  let changed = false;
  let status: VerificationStatus = "not_applicable";
  for (const turn of journal.turns) {
    for (const action of turn.actions) {
      if (action.type === "workspace_mutation") { changed = true; status = "not_run"; }
      else if (action.type === "verification" && changed) status = action.outcome === "passed" ? "passed_after_last_change" : "failed_after_last_change";
    }
  }
  return status;
}

export function isWorkspaceMutationAction(action: TurnActionRecord): action is Extract<TurnActionRecord, { readonly type: "workspace_mutation" }> {
  return action.type === "workspace_mutation";
}
