/**
 * Config schema validation
 */

import type { Config, Connector, Transport, StdioTransport, CatalogSecurityConfig } from '../types/index.js';

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

function validateStdioTransport(transport: StdioTransport, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof transport.command !== 'string' || !transport.command.trim()) {
    errors.push({ path: `${path}.command`, message: 'command must be a non-empty string' });
  }

  if (transport.args !== undefined && !Array.isArray(transport.args)) {
    errors.push({ path: `${path}.args`, message: 'args must be an array' });
  } else if (transport.args) {
    transport.args.forEach((arg, i) => {
      if (typeof arg !== 'string') {
        errors.push({ path: `${path}.args[${i}]`, message: 'each arg must be a string' });
      }
    });
  }

  if (transport.env !== undefined && (typeof transport.env !== 'object' || transport.env === null)) {
    errors.push({ path: `${path}.env`, message: 'env must be an object' });
  }

  if (transport.cwd !== undefined && typeof transport.cwd !== 'string') {
    errors.push({ path: `${path}.cwd`, message: 'cwd must be a string' });
  }

  return errors;
}

function validateTransport(transport: Transport, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!transport || typeof transport !== 'object') {
    errors.push({ path, message: 'transport must be an object' });
    return errors;
  }

  if (!('type' in transport)) {
    errors.push({ path: `${path}.type`, message: 'transport.type is required' });
    return errors;
  }

  switch (transport.type) {
    case 'stdio':
      errors.push(...validateStdioTransport(transport, path));
      break;
    case 'rpc-http':
    case 'rpc-sse':
      // Reserved for future implementation
      if (!('url' in transport) || typeof transport.url !== 'string') {
        errors.push({ path: `${path}.url`, message: 'url is required for HTTP/SSE transport' });
      }
      break;
    default:
      errors.push({ path: `${path}.type`, message: `unknown transport type: ${(transport as { type: string }).type}` });
  }

  return errors;
}

function validateConnector(connector: Connector, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!connector || typeof connector !== 'object') {
    errors.push({ path, message: 'connector must be an object' });
    return errors;
  }

  if (typeof connector.id !== 'string' || !connector.id.trim()) {
    errors.push({ path: `${path}.id`, message: 'id must be a non-empty string' });
  } else if (!/^[a-zA-Z0-9_-]+$/.test(connector.id)) {
    errors.push({ path: `${path}.id`, message: 'id must contain only alphanumeric characters, hyphens, and underscores' });
  }

  if (typeof connector.enabled !== 'boolean') {
    errors.push({ path: `${path}.enabled`, message: 'enabled must be a boolean' });
  }

  if (!connector.transport) {
    errors.push({ path: `${path}.transport`, message: 'transport is required' });
  } else {
    errors.push(...validateTransport(connector.transport, `${path}.transport`));
  }

  return errors;
}

export function validateConfig(config: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'config must be an object' }] };
  }

  const cfg = config as Record<string, unknown>;

  if (cfg.version !== 1) {
    errors.push({ path: 'version', message: 'version must be 1' });
  }

  if (!Array.isArray(cfg.connectors)) {
    errors.push({ path: 'connectors', message: 'connectors must be an array' });
  } else {
    const connectors = cfg.connectors as Connector[];
    const ids = new Set<string>();

    connectors.forEach((connector, i) => {
      errors.push(...validateConnector(connector, `connectors[${i}]`));

      // Check for duplicate IDs
      if (connector.id && ids.has(connector.id)) {
        errors.push({ path: `connectors[${i}].id`, message: `duplicate connector id: ${connector.id}` });
      }
      if (connector.id) {
        ids.add(connector.id);
      }
    });
  }

  // Validate catalog.security if present
  if (cfg.catalog && typeof cfg.catalog === 'object') {
    const catalog = cfg.catalog as Record<string, unknown>;
    if (catalog.security !== undefined) {
      errors.push(...validateCatalogSecurity(catalog.security, 'catalog.security'));
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate catalog security configuration
 */
function validateCatalogSecurity(security: unknown, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!security || typeof security !== 'object') {
    errors.push({ path, message: 'security must be an object' });
    return errors;
  }

  const sec = security as CatalogSecurityConfig;

  // trustedOnly must be boolean if present
  if (sec.trustedOnly !== undefined && typeof sec.trustedOnly !== 'boolean') {
    errors.push({ path: `${path}.trustedOnly`, message: 'trustedOnly must be a boolean' });
  }

  // trustedNpmScopes must be array of strings starting with @
  if (sec.trustedNpmScopes !== undefined) {
    if (!Array.isArray(sec.trustedNpmScopes)) {
      errors.push({ path: `${path}.trustedNpmScopes`, message: 'trustedNpmScopes must be an array' });
    } else {
      sec.trustedNpmScopes.forEach((scope, i) => {
        if (typeof scope !== 'string') {
          errors.push({
            path: `${path}.trustedNpmScopes[${i}]`,
            message: 'each scope must be a string',
          });
        } else if (!scope.startsWith('@')) {
          errors.push({
            path: `${path}.trustedNpmScopes[${i}]`,
            message: `scope must start with @: "${scope}"`,
          });
        }
      });
    }
  }

  // allowSources must be object with boolean values
  if (sec.allowSources !== undefined) {
    if (typeof sec.allowSources !== 'object' || sec.allowSources === null || Array.isArray(sec.allowSources)) {
      errors.push({ path: `${path}.allowSources`, message: 'allowSources must be an object' });
    } else {
      for (const [key, value] of Object.entries(sec.allowSources)) {
        if (typeof value !== 'boolean') {
          errors.push({
            path: `${path}.allowSources.${key}`,
            message: 'each value must be a boolean',
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Parse and validate config JSON
 */
export function parseConfig(jsonString: string): { config: Config | null; errors: ValidationError[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      config: null,
      errors: [{ path: '', message: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}` }],
    };
  }

  const result = validateConfig(parsed);
  if (!result.valid) {
    return { config: null, errors: result.errors };
  }

  return { config: parsed as Config, errors: [] };
}
