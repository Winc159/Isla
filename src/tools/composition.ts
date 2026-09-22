import type { WebFetchConfig, WebSearchConfig } from "../config.js";
import { createProjectFilesCapability } from "./project-files.js";
import { createProjectDiscoveryCapability } from "./project-discovery.js";
import type { ToolCapability } from "./types.js";
import { createWebCapability } from "./web.js";
import { createUserInteractionCapability } from "./user-interaction.js";
import type { UserQuestionService } from "../user-questions/types.js";
import { createCommandExecutionCapability } from "./command-execution.js";
import { createTaskStateCapability } from "./task-state.js";
import { createSessionQueryCapability } from "./session-query.js";
import type { SessionQuery } from "../session-query.js";
import type { SkillCatalog } from "../skills/catalog.js";
import { createSkillCapability } from "./skill.js";

export interface ToolCompositionContext {
  readonly workspaceRoot: string;
  readonly webFetch?: WebFetchConfig;
  readonly webSearch?: WebSearchConfig;
  readonly userQuestionService?: UserQuestionService;
  readonly sessionQuery?: SessionQuery;
  readonly workspaceKey?: string;
  readonly currentSessionId?: () => string;
  readonly skillCatalog?: SkillCatalog;
  readonly skillAllow?: readonly string[];
  readonly skillDeny?: readonly string[];
}

export type ToolCapabilityFactory = (context: ToolCompositionContext) => ToolCapability | undefined;

const capabilityFactories: readonly ToolCapabilityFactory[] = [
  context => createProjectFilesCapability(context.workspaceRoot),
  context => createProjectDiscoveryCapability(context.workspaceRoot),
  context => createCommandExecutionCapability(context.workspaceRoot),
  () => createTaskStateCapability(),
  context => context.sessionQuery && context.workspaceKey && context.currentSessionId ? createSessionQueryCapability(context.sessionQuery, context.workspaceKey, context.currentSessionId) : undefined,
  context => context.skillCatalog ? createSkillCapability(context.skillCatalog, context.skillAllow, context.skillDeny) : undefined,
  context => context.userQuestionService ? createUserInteractionCapability(context.userQuestionService) : undefined,
  context => context.webFetch?.enabled || context.webSearch?.enabled
    ? createWebCapability({
        ...(context.webFetch ? { webFetch: context.webFetch } : {}),
        ...(context.webSearch ? { webSearch: context.webSearch } : {}),
      })
    : undefined,
];

export function createToolCapabilities(context: ToolCompositionContext): readonly ToolCapability[] {
  return capabilityFactories.flatMap(factory => {
    const capability = factory(context);
    return capability ? [capability] : [];
  });
}
