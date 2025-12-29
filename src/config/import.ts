/**
 * Import mcpServers format from mcp.so / Claude Desktop
 *
 * Supported input formats:
 * A) Full: { "mcpServers": { "time": { "command": "uvx", "args": [...] } } }
 * B) mcpServers object: { "time": { "command": "uvx", "args": [...] } }
 * C) Single server: { "command": "uvx", "args": [...] }
 */

import type { Connector, StdioTransport } from '../types/index.js';

interface McpServerDef {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpServersWrapper {
  mcpServers: Record<string, McpServerDef>;
}

export interface ImportResult {
  connectors: Connector[];
  errors: string[];
}

function isMcpServerDef(obj: unknown): obj is McpServerDef {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.command === 'string';
}

function isMcpServersWrapper(obj: unknown): obj is McpServersWrapper {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.mcpServers === 'object' && o.mcpServers !== null;
}

function isMcpServersObject(obj: unknown): obj is Record<string, McpServerDef> {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;

  // Check if all values look like server definitions
  for (const value of Object.values(o)) {
    if (!isMcpServerDef(value)) return false;
  }
  return Object.keys(o).length > 0;
}

function serverDefToConnector(id: string, def: McpServerDef): Connector {
  const transport: StdioTransport = {
    type: 'stdio',
    command: def.command,
  };

  if (def.args && def.args.length > 0) {
    transport.args = def.args;
  }
  if (def.env && Object.keys(def.env).length > 0) {
    transport.env = def.env;
  }
  if (def.cwd) {
    transport.cwd = def.cwd;
  }

  return {
    id,
    enabled: true,
    transport,
  };
}

export function parseMcpServers(jsonString: string, singleName?: string): ImportResult {
  const result: ImportResult = { connectors: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    result.errors.push(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
    return result;
  }

  // Case A: Full wrapper with mcpServers
  if (isMcpServersWrapper(parsed)) {
    const servers = parsed.mcpServers;
    for (const [id, def] of Object.entries(servers)) {
      if (isMcpServerDef(def)) {
        result.connectors.push(serverDefToConnector(id, def));
      } else {
        result.errors.push(`Invalid server definition for '${id}'`);
      }
    }
    return result;
  }

  // Case C: Single server definition
  if (isMcpServerDef(parsed)) {
    if (!singleName) {
      result.errors.push('Single server definition requires --name option');
      return result;
    }
    result.connectors.push(serverDefToConnector(singleName, parsed));
    return result;
  }

  // Case B: Object with multiple servers (no wrapper)
  if (isMcpServersObject(parsed)) {
    for (const [id, def] of Object.entries(parsed)) {
      result.connectors.push(serverDefToConnector(id, def));
    }
    return result;
  }

  result.errors.push('Unrecognized format: expected mcpServers object or server definition');
  return result;
}

/**
 * Read from stdin until EOF
 */
export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    process.stdin.on('error', reject);
  });
}
