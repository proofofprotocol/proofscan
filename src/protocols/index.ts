/**
 * Protocol Adapters
 *
 * Export all protocol adapters and utilities
 */

export * from './IProtocolAdapter.js';
export * from './McpAdapter.js';
export * from './A2aAdapter.js';

import { ProtocolAdapterRegistry } from './IProtocolAdapter.js';
import { McpAdapter } from './McpAdapter.js';
import { A2aAdapter } from './A2aAdapter.js';

/**
 * Create a default registry with all adapters
 */
export function createDefaultRegistry(): ProtocolAdapterRegistry {
  const registry = new ProtocolAdapterRegistry();

  // Register adapters in priority order
  // MCP is the primary protocol
  registry.register(new McpAdapter());

  // A2A is a stub for future support
  registry.register(new A2aAdapter());

  return registry;
}
