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
  /** Allow local/private URLs (development only) */
  allow_local?: boolean;
}

/**
 * Authentication configuration for A2A agents.
 */
export interface AuthConfig {
  type: 'bearer' | 'api_key' | 'oauth2';
  token_ref?: string; // e.g., "dpapi:proofscan/agents/xxx"
  header_name?: string; // for api_key auth (e.g., "X-API-Key")
}

// ===== Streaming Event Types (Phase 5) =====

/**
 * Task status update event from SSE stream
 */
export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId?: string;
  status: 'pending' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled' | 'rejected';
  message?: {
    role: 'user' | 'assistant';
    parts: Array<{ text: string } | { data: string; mimeType: string }>;
    metadata?: Record<string, unknown>;
    contextId?: string;
    referenceTaskIds?: string[];
  };
  final?: boolean; // true indicates the end of the stream
}

/**
 * Task artifact update event from SSE stream
 */
export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId?: string;
  artifact: {
    name?: string;
    description?: string;
    parts: Array<{ text: string } | { data: string; mimeType: string }>;
    index?: number; // Artifact index
    append?: boolean; // Whether this appends to previous artifact
    lastChunk?: boolean; // Whether this is the last chunk
  };
}

// ===== A2A Message & Task Types =====

/**
 * A2A message exchanged between agents
 */
export interface A2AMessage {
  role: 'user' | 'assistant';
  parts: Array<{ text: string } | { data: string; mimeType: string }>;
  messageId?: string;
  metadata?: Record<string, unknown>;
  contextId?: string;
  referenceTaskIds?: string[];
}

/**
 * A2A task representing a unit of work
 */
export interface A2ATask {
  id: string;
  status: 'pending' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled' | 'rejected';
  messages: A2AMessage[];
  artifacts?: Array<{
    name?: string;
    description?: string;
    parts: Array<{ text: string } | { data: string; mimeType: string }>;
  }>;
  createdAt?: string;
  updatedAt?: string;
  contextId?: string;
}

/**
 * Stream event type (discriminated union)
 */
export type StreamEvent =
  | { type: 'status'; event: TaskStatusUpdateEvent }
  | { type: 'artifact'; event: TaskArtifactUpdateEvent }
  | { type: 'task'; task: A2ATask }
  | { type: 'message'; message: A2AMessage };

/**
 * Stream message result
 */
export interface StreamMessageResult {
  ok: boolean;
  taskId?: string;
  error?: string;
}

// ===== Discriminated Union for Type-Safe Config Parsing =====

/**
 * TargetConfig is a discriminated union for type-safe config parsing.
 * The `type` and `protocol` fields are discriminators.
 */
export type TargetConfig =
  | { type: 'connector'; protocol: 'mcp'; config: ConnectorConfigV1 }
  | { type: 'agent'; protocol: 'a2a'; config: AgentConfigV1 };
