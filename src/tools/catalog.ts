export type ToolCategory = 'file' | 'search' | 'command' | 'task' | 'session' | 'browser' | 'web' | 'capability' | 'interaction' | 'skill' | 'other';
export type ToolBoundary = 'read' | 'write' | 'execute' | 'external' | 'control';

export interface ToolClassification {
  readonly category: ToolCategory;
  readonly boundary: ToolBoundary;
  readonly canonicalPurpose: string;
}

const CLASSIFICATIONS: Readonly<Record<string, ToolClassification>> = {
  read_text_file: { category: 'file', boundary: 'read', canonicalPurpose: '读取工作区文件内容' },
  edit_text_file: { category: 'file', boundary: 'write', canonicalPurpose: '对已观察文本做精确替换' },
  write_text_file: { category: 'file', boundary: 'write', canonicalPurpose: '创建或整体写入文本文件' },
  list_directory: { category: 'file', boundary: 'read', canonicalPurpose: '列出工作区目录' },
  glob_project: { category: 'search', boundary: 'read', canonicalPurpose: '按路径模式发现文件' },
  grep_project: { category: 'search', boundary: 'read', canonicalPurpose: '按内容模式定位匹配行' },
  search_project: { category: 'search', boundary: 'read', canonicalPurpose: '获取带来源标识的语义项目片段' },
  run_command: { category: 'command', boundary: 'execute', canonicalPurpose: '在工作区执行受控命令' },
  update_task_state: { category: 'task', boundary: 'control', canonicalPurpose: '更新持久化任务状态' },
  search_session_history: { category: 'session', boundary: 'read', canonicalPurpose: '搜索当前工作区历史会话' },
  read_session_context: { category: 'session', boundary: 'read', canonicalPurpose: '读取有限历史会话上下文' },
  context_find: { category: 'session', boundary: 'read', canonicalPurpose: '查找已压缩历史片段' },
  context_read: { category: 'session', boundary: 'read', canonicalPurpose: '分页读取历史细节' },
  web_fetch: { category: 'web', boundary: 'external', canonicalPurpose: '获取已允许的公开网页' },
  web_search: { category: 'web', boundary: 'external', canonicalPurpose: '搜索外部公开来源' },
  ask_user_question: { category: 'interaction', boundary: 'control', canonicalPurpose: '向用户请求缺失信息或授权' },
  skill: { category: 'skill', boundary: 'control', canonicalPurpose: '调用已安装 Skill' },
  capability_search: { category: 'capability', boundary: 'read', canonicalPurpose: '搜索可发现能力' },
  capability_activate: { category: 'capability', boundary: 'control', canonicalPurpose: '激活任务能力' },
  capability_status: { category: 'capability', boundary: 'read', canonicalPurpose: '查看能力状态' },
  tool_catalog: { category: 'capability', boundary: 'read', canonicalPurpose: '查看工具目录和职责边界' },
};

export function classifyTool(name: string): ToolClassification {
  if (CLASSIFICATIONS[name]) return CLASSIFICATIONS[name];
  if (name.startsWith('browser_')) return { category: 'browser', boundary: browserBoundary(name), canonicalPurpose: '浏览器会话操作' };
  return { category: 'other', boundary: 'control', canonicalPurpose: '未分类工具；需要补充职责说明' };
}

function browserBoundary(name: string): ToolBoundary {
  if (name === 'browser_open' || name === 'browser_navigate' || name === 'browser_click' || name === 'browser_type' || name === 'browser_select' || name === 'browser_wait' || name === 'browser_scroll' || name === 'browser_back') return 'external';
  if (name === 'browser_close') return 'control';
  return 'read';
}

export function toolClassificationEntries(): readonly [string, ToolClassification][] {
  return Object.entries(CLASSIFICATIONS);
}
