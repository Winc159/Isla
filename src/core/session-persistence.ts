import type { CapabilityActivationStateV1 } from "../capabilities/routing.js";
import type { StoredSkillCatalogV1 } from "../sessions/store.js";
import type { TaskBrief } from "./agent-loop.js";
import type { SessionContext } from "./context.js";
import type { SessionJournal } from "./journal.js";
import type { TaskStateV1 } from "./task-state.js";
import type { TaskContractV1 } from "./task-contract.js";
import type { Message } from "./types.js";

export interface SessionPersistenceState {
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly journal: SessionJournal;
  readonly task?: TaskBrief | TaskStateV1;
  readonly taskContract?: TaskContractV1;
  readonly skillCatalog?: StoredSkillCatalogV1;
  readonly capabilityActivation?: CapabilityActivationStateV1;
}

export interface SessionPersistenceSource {
  readonly messages: readonly Message[];
  readonly context: SessionContext | undefined;
  readonly journal: SessionJournal;
  readonly task: TaskBrief | TaskStateV1 | undefined;
  readonly taskContract?: TaskContractV1;
  readonly skillCatalog: StoredSkillCatalogV1 | undefined;
  readonly capabilityActivation: CapabilityActivationStateV1 | undefined;
}

export function buildSessionPersistenceState(source: SessionPersistenceSource): SessionPersistenceState {
  return {
    messages: [...source.messages],
    ...(source.context ? { context: source.context } : {}),
    journal: source.journal,
    ...(source.task ? { task: source.task } : {}),
    ...(source.taskContract ? { taskContract: source.taskContract } : {}),
    ...(source.skillCatalog ? { skillCatalog: source.skillCatalog } : {}),
    ...(source.capabilityActivation ? { capabilityActivation: source.capabilityActivation } : {}),
  };
}
