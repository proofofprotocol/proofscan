/**
 * Permission checking (default deny)
 * Phase 8.2: Bearer Token Authentication
 */

/**
 * Check if permissions grant access to required permission
 * 
 * Permission format: <protocol>:<action>:<target>
 * Examples:
 *   - "mcp:*" matches any MCP operation
 *   - "mcp:call:*" matches any MCP call
 *   - "mcp:call:yfinance" matches only yfinance MCP call
 *   - "registry:read" matches registry read
 * 
 * Evaluation rules:
 *   - Default deny: if not explicitly granted, deny
 *   - Wildcard (*) matches any segment
 *   - More specific permissions take precedence (not implemented in Phase 8)
 * 
 * @param permissions Array of granted permissions
 * @param required Required permission string
 * @returns true if permission is granted, false otherwise
 */
export function hasPermission(
  permissions: string[],
  required: string
): boolean {
  const requiredParts = required.split(':');

  for (const permission of permissions) {
    if (matchesPermission(permission, requiredParts)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a single permission matches the required parts
 */
function matchesPermission(permission: string, requiredParts: string[]): boolean {
  const permParts = permission.split(':');

  for (let i = 0; i < requiredParts.length; i++) {
    // Permission is shorter than required and no wildcard at end
    if (i >= permParts.length) {
      return false;
    }

    const permPart = permParts[i];
    const reqPart = requiredParts[i];

    // Wildcard matches everything from this point
    if (permPart === '*') {
      return true;
    }

    // Exact match required
    if (permPart !== reqPart) {
      return false;
    }
  }

  // All required parts matched
  // Permission may have more parts, but that's fine (more specific is ok)
  return true;
}

/**
 * Build required permission string for MCP operations
 */
export function buildMCPPermission(
  method: string,
  connector?: string
): string {
  // method examples: "tools/call", "resources/read"
  const action = method.replace('/', ':');
  
  if (connector) {
    return `mcp:${action}:${connector}`;
  }
  return `mcp:${action}`;
}

/**
 * Build required permission string for A2A operations
 */
export function buildA2APermission(
  method: string,
  agent?: string
): string {
  if (agent) {
    return `a2a:${method}:${agent}`;
  }
  return `a2a:${method}`;
}
