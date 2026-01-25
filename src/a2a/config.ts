/**
 * A2A Config Validation
 *
 * Validation functions for A2A config parsing.
 */

import type { TargetType, TargetProtocol } from '../db/types.js';
import type {
  ConnectorConfigV1,
  AgentConfigV1,
  TargetConfig,
  AgentCard,
  AgentSkill,
} from './types.js';

// ===== Result Type =====

/**
 * Result type for validation operations.
 */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ===== Helper Functions =====

/**
 * Checks if a value is a plain object (not null, not array).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks if a value is a string.
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Checks if a value is a number.
 */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Validates that a field exists and is of the expected type.
 */
function requireField<T>(
  obj: Record<string, unknown>,
  field: string,
  typeName: string,
  validator: (v: unknown) => v is T
): T {
  const value = obj[field];
  if (value === undefined) {
    throw new Error(`Missing required field: ${field}`);
  }
  if (!validator(value)) {
    throw new Error(`Field ${field} must be ${typeName}, got ${typeof value}`);
  }
  return value;
}

/**
 * Validates an optional field.
 */
function optionalField<T>(
  obj: Record<string, unknown>,
  field: string,
  validator: (v: unknown) => v is T
): T | undefined {
  const value = obj[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!validator(value)) {
    throw new Error(`Field ${field} must be ${typeName}, got ${typeof value}`);
  }
  return value;
}

/**
 * Validates a record<string, string> field.
 */
function requireStringRecord(obj: Record<string, unknown>, field: string): Record<string, string> {
  const value = obj[field];
  if (value === undefined) {
    throw new Error(`Missing required field: ${field}`);
  }
  if (!isPlainObject(value)) {
    throw new Error(`Field ${field} must be an object, got ${typeof value}`);
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isString(v)) {
      throw new Error(`Field ${field}[${k}] must be a string, got ${typeof v}`);
    }
    result[k] = v;
  }
  return result;
}

/**
 * Validates an optional record<string, string> field.
 */
function optionalStringRecord(obj: Record<string, unknown>, field: string): Record<string, string> | undefined {
  const value = obj[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new Error(`Field ${field} must be an object, got ${typeof value}`);
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isString(v)) {
      throw new Error(`Field ${field}[${k}] must be a string, got ${typeof v}`);
    }
    result[k] = v;
  }
  return result;
}

// ===== ConnectorConfigV1 Validator =====

/**
 * Validates a ConnectorConfigV1 object.
 */
export function parseConnectorConfig(json: unknown): ParseResult<ConnectorConfigV1> {
  try {
    if (!isPlainObject(json)) {
      return { ok: false, error: 'Config must be an object' };
    }

    // Check schema_version
    const schemaVersion = requireField(json, 'schema_version', 'a number', isNumber);
    if (schemaVersion !== 1) {
      return { ok: false, error: `Unsupported schema_version: ${schemaVersion}, expected 1` };
    }

    // Check transport (required)
    const transport = requireField(json, 'transport', 'a string', isString);
    if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
      return {
        ok: false,
        error: `Invalid transport: ${transport}, must be 'stdio', 'http', or 'sse'`,
      };
    }

    const result: ConnectorConfigV1 = {
      schema_version: 1,
      transport,
    };

    // Optional fields
    if ('command' in json) {
      result.command = requireField(json, 'command', 'a string', isString);
    }

    if ('args' in json) {
      const args = json['args'];
      if (!Array.isArray(args)) {
        return { ok: false, error: 'Field args must be an array' };
      }
      const stringArgs: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (!isString(args[i])) {
          return { ok: false, error: `Field args[${i}] must be a string` };
        }
        stringArgs.push(args[i]);
      }
      result.args = stringArgs;
    }

    if ('env' in json) {
      result.env = requireStringRecord(json, 'env');
    }

    if ('url' in json) {
      result.url = requireField(json, 'url', 'a string', isString);
    }

    if ('headers' in json) {
      result.headers = requireStringRecord(json, 'headers');
    }

    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===== AgentConfigV1 Validator =====

/**
 * Validates an AgentConfigV1 object.
 */
export function parseAgentConfig(json: unknown): ParseResult<AgentConfigV1> {
  try {
    if (!isPlainObject(json)) {
      return { ok: false, error: 'Config must be an object' };
    }

    // Check schema_version
    const schemaVersion = requireField(json, 'schema_version', 'a number', isNumber);
    if (schemaVersion !== 1) {
      return { ok: false, error: `Unsupported schema_version: ${schemaVersion}, expected 1` };
    }

    // Check url (required)
    const url = requireField(json, 'url', 'a string', isString);

    const result: AgentConfigV1 = {
      schema_version: 1,
      url,
    };

    // Optional fields
    if ('ttl_seconds' in json) {
      const ttl = json['ttl_seconds'];
      if (!isNumber(ttl) || ttl < 0) {
        return { ok: false, error: 'Field ttl_seconds must be a non-negative number' };
      }
      result.ttl_seconds = ttl;
    }

    if ('auth' in json) {
      const authResult = parseAuthConfig(json['auth']);
      if (!authResult.ok) {
        return authResult;
      }
      result.auth = authResult.value;
    }

    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===== AuthConfig Validator =====

/**
 * Validates an AuthConfig object.
 */
function parseAuthConfig(json: unknown): ParseResult<AuthConfig> {
  try {
    if (!isPlainObject(json)) {
      return { ok: false, error: 'Auth config must be an object' };
    }

    const type = requireField(json, 'type', 'a string', isString);
    if (type !== 'bearer' && type !== 'api_key' && type !== 'oauth2') {
      return {
        ok: false,
        error: `Invalid auth type: ${type}, must be 'bearer', 'api_key', or 'oauth2'`,
      };
    }

    const result: AuthConfig = { type };

    if ('token_ref' in json) {
      result.token_ref = requireField(json, 'token_ref', 'a string', isString);
    }

    if ('header_name' in json) {
      result.header_name = requireField(json, 'header_name', 'a string', isString);
    }

    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===== AgentCard Validator =====

/**
 * Validates an AgentSkill object.
 */
function parseAgentSkill(json: unknown): ParseResult<AgentSkill> {
  try {
    if (!isPlainObject(json)) {
      return { ok: false, error: 'Agent skill must be an object' };
    }

    const id = requireField(json, 'id', 'a string', isString);
    const name = requireField(json, 'name', 'a string', isString);

    const result: AgentSkill = { id, name };

    if ('description' in json) {
      result.description = requireField(json, 'description', 'a string', isString);
    }

    if ('tags' in json) {
      const tags = json['tags'];
      if (!Array.isArray(tags)) {
        return { ok: false, error: 'Field tags must be an array' };
      }
      const stringTags: string[] = [];
      for (let i = 0; i < tags.length; i++) {
        if (!isString(tags[i])) {
          return { ok: false, error: `Field tags[${i}] must be a string` };
        }
        stringTags.push(tags[i]);
      }
      result.tags = stringTags;
    }

    if ('examples' in json) {
      const examples = json['examples'];
      if (!Array.isArray(examples)) {
        return { ok: false, error: 'Field examples must be an array' };
      }
      const stringExamples: string[] = [];
      for (let i = 0; i < examples.length; i++) {
        if (!isString(examples[i])) {
          return { ok: false, error: `Field examples[${i}] must be a string` };
        }
        stringExamples.push(examples[i]);
      }
      result.examples = stringExamples;
    }

    if ('inputModes' in json) {
      const inputModes = json['inputModes'];
      if (!Array.isArray(inputModes)) {
        return { ok: false, error: 'Field inputModes must be an array' };
      }
      const stringModes: string[] = [];
      for (let i = 0; i < inputModes.length; i++) {
        if (!isString(inputModes[i])) {
          return { ok: false, error: `Field inputModes[${i}] must be a string` };
        }
        stringModes.push(inputModes[i]);
      }
      result.inputModes = stringModes;
    }

    if ('outputModes' in json) {
      const outputModes = json['outputModes'];
      if (!Array.isArray(outputModes)) {
        return { ok: false, error: 'Field outputModes must be an array' };
      }
      const stringModes: string[] = [];
      for (let i = 0; i < outputModes.length; i++) {
        if (!isString(outputModes[i])) {
          return { ok: false, error: `Field outputModes[${i}] must be a string` };
        }
        stringModes.push(outputModes[i]);
      }
      result.outputModes = stringModes;
    }

    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Validates an AgentCard object.
 */
export function parseAgentCard(json: unknown): ParseResult<AgentCard> {
  try {
    if (!isPlainObject(json)) {
      return { ok: false, error: 'Agent card must be an object' };
    }

    const name = requireField(json, 'name', 'a string', isString);
    const url = requireField(json, 'url', 'a string', isString);
    const version = requireField(json, 'version', 'a string', isString);

    const result: AgentCard = { name, url, version };

    if ('description' in json) {
      result.description = requireField(json, 'description', 'a string', isString);
    }

    if ('provider' in json) {
      const provider = json['provider'];
      if (!isPlainObject(provider)) {
        return { ok: false, error: 'Field provider must be an object' };
      }
      const providerData: NonNullable<AgentCard['provider']> = {};
      if ('organization' in provider) {
        providerData.organization = requireField(provider, 'organization', 'a string', isString);
      }
      if ('url' in provider) {
        providerData.url = requireField(provider, 'url', 'a string', isString);
      }
      if (Object.keys(providerData).length > 0) {
        result.provider = providerData;
      }
    }

    if ('documentationUrl' in json) {
      result.documentationUrl = requireField(json, 'documentationUrl', 'a string', isString);
    }

    if ('capabilities' in json) {
      const capabilities = json['capabilities'];
      if (!isPlainObject(capabilities)) {
        return { ok: false, error: 'Field capabilities must be an object' };
      }
      const capabilitiesData: NonNullable<AgentCard['capabilities']> = {};
      if ('streaming' in capabilities) {
        const streaming = capabilities['streaming'];
        if (typeof streaming !== 'boolean') {
          return { ok: false, error: 'Field capabilities.streaming must be a boolean' };
        }
        capabilitiesData.streaming = streaming;
      }
      if ('pushNotifications' in capabilities) {
        const pushNotifications = capabilities['pushNotifications'];
        if (typeof pushNotifications !== 'boolean') {
          return { ok: false, error: 'Field capabilities.pushNotifications must be a boolean' };
        }
        capabilitiesData.pushNotifications = pushNotifications;
      }
      if ('stateTransitionHistory' in capabilities) {
        const stateTransitionHistory = capabilities['stateTransitionHistory'];
        if (typeof stateTransitionHistory !== 'boolean') {
          return { ok: false, error: 'Field capabilities.stateTransitionHistory must be a boolean' };
        }
        capabilitiesData.stateTransitionHistory = stateTransitionHistory;
      }
      if (Object.keys(capabilitiesData).length > 0) {
        result.capabilities = capabilitiesData;
      }
    }

    if ('authentication' in json) {
      const auth = json['authentication'];
      if (!isPlainObject(auth)) {
        return { ok: false, error: 'Field authentication must be an object' };
      }
      const authData: NonNullable<AgentCard['authentication']> = {};
      if ('schemes' in auth) {
        const schemes = auth['schemes'];
        if (!Array.isArray(schemes)) {
          return { ok: false, error: 'Field authentication.schemes must be an array' };
        }
        const stringSchemes: string[] = [];
        for (let i = 0; i < schemes.length; i++) {
          if (!isString(schemes[i])) {
            return { ok: false, error: `Field authentication.schemes[${i}] must be a string` };
          }
          stringSchemes.push(schemes[i]);
        }
        authData.schemes = stringSchemes;
      }
      if ('credentials' in auth) {
        authData.credentials = requireField(auth, 'credentials', 'a string', isString);
      }
      if (Object.keys(authData).length > 0) {
        result.authentication = authData;
      }
    }

    if ('defaultInputModes' in json) {
      const inputModes = json['defaultInputModes'];
      if (!Array.isArray(inputModes)) {
        return { ok: false, error: 'Field defaultInputModes must be an array' };
      }
      const stringModes: string[] = [];
      for (let i = 0; i < inputModes.length; i++) {
        if (!isString(inputModes[i])) {
          return { ok: false, error: `Field defaultInputModes[${i}] must be a string` };
        }
        stringModes.push(inputModes[i]);
      }
      result.defaultInputModes = stringModes;
    }

    if ('defaultOutputModes' in json) {
      const outputModes = json['defaultOutputModes'];
      if (!Array.isArray(outputModes)) {
        return { ok: false, error: 'Field defaultOutputModes must be an array' };
      }
      const stringModes: string[] = [];
      for (let i = 0; i < outputModes.length; i++) {
        if (!isString(outputModes[i])) {
          return { ok: false, error: `Field defaultOutputModes[${i}] must be a string` };
        }
        stringModes.push(outputModes[i]);
      }
      result.defaultOutputModes = stringModes;
    }

    if ('skills' in json) {
      const skills = json['skills'];
      if (!Array.isArray(skills)) {
        return { ok: false, error: 'Field skills must be an array' };
      }
      const parsedSkills: AgentSkill[] = [];
      for (let i = 0; i < skills.length; i++) {
        const skillResult = parseAgentSkill(skills[i]);
        if (!skillResult.ok) {
          return { ok: false, error: `Field skills[${i}]: ${skillResult.error}` };
        }
        parsedSkills.push(skillResult.value);
      }
      result.skills = parsedSkills;
    }

    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===== Main Target Config Parser =====

/**
 * Parses and validates a target config from JSON string.
 * Uses the type and protocol to determine which config schema to apply.
 */
export function parseTargetConfig(
  type: TargetType,
  protocol: TargetProtocol,
  configJson: string
): ParseResult<TargetConfig> {
  // Validate type/protocol combination
  if (type === 'connector' && protocol !== 'mcp') {
    return { ok: false, error: `Invalid combination: type='connector' requires protocol='mcp', got '${protocol}'` };
  }
  if (type === 'agent' && protocol !== 'a2a') {
    return { ok: false, error: `Invalid combination: type='agent' requires protocol='a2a', got '${protocol}'` };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Parse based on type
  if (type === 'connector') {
    const result = parseConnectorConfig(parsed);
    if (!result.ok) {
      return { ok: false, error: `Connector config error: ${result.error}` };
    }
    return { ok: true, value: { type, protocol, config: result.value } };
  } else {
    // type === 'agent'
    const result = parseAgentConfig(parsed);
    if (!result.ok) {
      return { ok: false, error: `Agent config error: ${result.error}` };
    }
    return { ok: true, value: { type, protocol, config: result.value } };
  }
}
