/**
 * Plans schema definitions
 * Phase 5.2: Validation plans for MCP servers
 */

/**
 * Plan step definition - a single MCP method call
 */
export interface PlanStep {
  /** MCP method to call: 'initialize' | 'tools/list' | 'resources/list' | 'prompts/list' */
  mcp: string;
  /** Conditional execution: 'capabilities.tools' | 'capabilities.resources' | 'capabilities.prompts' */
  when?: string;
}

/**
 * Plan definition as parsed from YAML
 */
export interface PlanDefinition {
  /** Schema version (must be 1) */
  version: 1;
  /** Optional plan name (overridden by DB record name) */
  name?: string;
  /** Optional description */
  description?: string;
  /** Validation steps to execute */
  steps: PlanStep[];
}

/**
 * Plan record stored in database
 */
export interface Plan {
  /** Unique plan name (identifier) */
  name: string;
  /** Schema version */
  schema_version: number;
  /** Original YAML content */
  content_yaml: string;
  /** Normalized YAML/JSON for digest calculation */
  content_normalized: string;
  /** SHA-256 digest of normalized content */
  digest_sha256: string;
  /** Optional description */
  description: string | null;
  /** Default connector ID */
  default_connector: string | null;
  /** Source of the plan: 'manual' | 'import' | 'builtin' */
  source: 'manual' | 'import' | 'builtin';
  /** Creation timestamp (ISO) */
  created_at: string;
  /** Last update timestamp (ISO) */
  updated_at: string;
}

/**
 * Run status
 */
export type RunStatus = 'running' | 'completed' | 'failed' | 'partial' | 'crashed';

/**
 * Run record stored in database
 */
export interface Run {
  /** Unique run ID (ULID) */
  run_id: string;
  /** Plan name (may be null if plan was deleted) */
  plan_name: string | null;
  /** Plan digest at time of execution */
  plan_digest: string;
  /** Connector ID used for execution */
  connector_id: string;
  /** Run status */
  status: RunStatus;
  /** Relative path to artifacts directory */
  artifact_path: string;
  /** Start timestamp (ISO) */
  started_at: string;
  /** End timestamp (ISO) - null if still running */
  ended_at: string | null;
  /** Record creation timestamp (ISO) */
  created_at: string;
}

/**
 * Step result from plan execution
 */
export interface StepResult {
  /** Step index (0-based) */
  stepIndex: number;
  /** MCP method called */
  method: string;
  /** Whether step was skipped due to when condition */
  skipped: boolean;
  /** Reason for skipping (if skipped) */
  skipReason?: string;
  /** Request sent */
  request: {
    method: string;
    params: unknown;
  };
  /** Response received (if not skipped) */
  response?: {
    result?: unknown;
    error?: unknown;
  };
  /** Start timestamp (ISO) */
  startedAt: string;
  /** End timestamp (ISO) */
  endedAt: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Inventory collected during plan execution
 */
export interface RunInventory {
  /** Capabilities from initialize response */
  capabilities?: unknown;
  /** Tools from tools/list response */
  tools?: unknown[];
  /** Resources from resources/list response */
  resources?: unknown[];
  /** Prompts from prompts/list response */
  prompts?: unknown[];
}

/**
 * Complete run result
 */
export interface RunResult {
  /** Run ID */
  runId: string;
  /** Plan name */
  planName: string;
  /** Plan digest */
  planDigest: string;
  /** Connector ID */
  connectorId: string;
  /** Final status */
  status: 'completed' | 'failed' | 'partial';
  /** Step results */
  steps: StepResult[];
  /** Collected inventory */
  inventory: RunInventory;
  /** Start timestamp */
  startedAt: string;
  /** End timestamp */
  endedAt: string;
}

/**
 * Run metadata written to meta.json
 */
export interface RunMeta {
  /** Run ID */
  runId: string;
  /** Plan name */
  planName: string;
  /** Plan digest at time of run */
  planDigest: string;
  /** Connector ID */
  connectorId: string;
  /** Run status */
  status: RunStatus;
  /** Start timestamp */
  startedAt: string;
  /** End timestamp */
  endedAt?: string;
  /** Total steps count */
  totalSteps: number;
  /** Passed steps count */
  passedSteps: number;
  /** Failed steps count */
  failedSteps: number;
  /** Skipped steps count */
  skippedSteps: number;
  /** Relative artifact path */
  artifactPath: string;
}

/**
 * Supported MCP methods in plans
 */
export const SUPPORTED_MCP_METHODS = [
  'initialize',
  'tools/list',
  'resources/list',
  'prompts/list',
] as const;

/**
 * Supported when conditions
 */
export const SUPPORTED_WHEN_CONDITIONS = [
  'capabilities.tools',
  'capabilities.resources',
  'capabilities.prompts',
] as const;

/**
 * Validate plan name format
 */
export function isValidPlanName(name: string): boolean {
  return /^[a-z0-9_-]+$/.test(name);
}

/**
 * Validate plan definition
 */
export function validatePlanDefinition(def: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!def || typeof def !== 'object') {
    return { valid: false, errors: ['Plan must be an object'] };
  }

  const plan = def as Record<string, unknown>;

  // Check version
  if (plan.version !== 1) {
    errors.push(`Invalid version: expected 1, got ${plan.version}`);
  }

  // Check steps
  if (!Array.isArray(plan.steps)) {
    errors.push('steps must be an array');
    return { valid: false, errors };
  }

  if (plan.steps.length === 0) {
    errors.push('steps array cannot be empty');
  }

  // Validate each step
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i] as Record<string, unknown>;

    if (!step || typeof step !== 'object') {
      errors.push(`Step ${i}: must be an object`);
      continue;
    }

    if (typeof step.mcp !== 'string') {
      errors.push(`Step ${i}: mcp must be a string`);
      continue;
    }

    if (!SUPPORTED_MCP_METHODS.includes(step.mcp as typeof SUPPORTED_MCP_METHODS[number])) {
      errors.push(`Step ${i}: unsupported mcp method '${step.mcp}'`);
    }

    if (step.when !== undefined) {
      if (typeof step.when !== 'string') {
        errors.push(`Step ${i}: when must be a string`);
      } else if (!SUPPORTED_WHEN_CONDITIONS.includes(step.when as typeof SUPPORTED_WHEN_CONDITIONS[number])) {
        errors.push(`Step ${i}: unsupported when condition '${step.when}'`);
      }
    }
  }

  // Check that initialize is first step (if present)
  if (plan.steps.length > 0) {
    const firstStep = plan.steps[0] as Record<string, unknown>;
    if (firstStep.mcp !== 'initialize') {
      errors.push('First step must be "initialize"');
    }
  }

  return { valid: errors.length === 0, errors };
}
