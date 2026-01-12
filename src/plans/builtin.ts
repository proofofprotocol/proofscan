/**
 * Built-in validation plans
 * Phase 5.3: Default plans for common validation scenarios
 */

export interface BuiltinPlan {
  name: string;
  yaml: string;
}

/**
 * Basic MCP validation plan
 * Performs: initialize, tools/list, resources/list (if supported), prompts/list (if supported)
 */
export const BASIC_MCP_PLAN: BuiltinPlan = {
  name: 'basic-mcp',
  yaml: `version: 1
name: basic-mcp
description: Basic MCP server validation (initialize, tools, resources, prompts)
steps:
  - mcp: initialize
  - mcp: tools/list
  - when: capabilities.resources
    mcp: resources/list
  - when: capabilities.prompts
    mcp: prompts/list
`,
};

/**
 * Minimal MCP validation plan
 * Performs only: initialize, tools/list
 */
export const MINIMAL_MCP_PLAN: BuiltinPlan = {
  name: 'minimal-mcp',
  yaml: `version: 1
name: minimal-mcp
description: Minimal MCP server validation (initialize + tools/list only)
steps:
  - mcp: initialize
  - mcp: tools/list
`,
};

/**
 * Full MCP validation plan
 * Attempts all list operations regardless of capabilities
 */
export const FULL_MCP_PLAN: BuiltinPlan = {
  name: 'full-mcp',
  yaml: `version: 1
name: full-mcp
description: Full MCP server validation (all list operations)
steps:
  - mcp: initialize
  - mcp: tools/list
  - mcp: resources/list
  - mcp: prompts/list
`,
};

/**
 * All built-in plans
 */
export const BUILTIN_PLANS: BuiltinPlan[] = [
  BASIC_MCP_PLAN,
  MINIMAL_MCP_PLAN,
  FULL_MCP_PLAN,
];

/**
 * Default plan name for quick validation
 */
export const DEFAULT_PLAN_NAME = 'basic-mcp';
