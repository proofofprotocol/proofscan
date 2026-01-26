/**
 * A2A Protocol Types
 *
 * Type definitions for A2A (Agent-to-Agent Protocol) integration.
 * See: https://a2a-protocol.org/latest/specification/
 */

// ===== Agent Card (A2A Protocol Specification) =====

/**
 * Agent Card represents the metadata and capabilities of an A2A agent.
 * Retrieved from the agent's well-known endpoint.
 */
export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  provider?: {
    organization?: string;
    url?: string;
  };
  version: string;
  documentationUrl?: string;
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills?: AgentSkill[];
}

/**
 * Agent Skill describes a specific capability of an agent.
 */
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

// ===== Config Types (schema_version) =====

/**
 * ConnectorConfigV1 for MCP connectors.
 */
export interface ConnectorConfigV1 {
  schema_version: 1;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * AgentConfigV1 for A2A agents.
 */
export interface AgentConfigV1 {
  schema_version: 1;
  url: string;
  ttl_seconds?: number;
  auth?: AuthConfig;
}

/**
 * Authentication configuration for A2A agents.
 */
export interface AuthConfig {
  type: 'bearer' | 'api_key' | 'oauth2';
  token_ref?: string; // e.g., "dpapi:proofscan/agents/xxx"
  header_name?: string; // for api_key auth (e.g., "X-API-Key")
}

// ===== Discriminated Union for Type-Safe Config Parsing =====

/**
 * TargetConfig is a discriminated union for type-safe config parsing.
 * The `type` and `protocol` fields are discriminators.
 */
export type TargetConfig =
  | { type: 'connector'; protocol: 'mcp'; config: ConnectorConfigV1 }
  | { type: 'agent'; protocol: 'a2a'; config: AgentConfigV1 };
