/**
 * Registry command - search and list locally registered connectors
 *
 * pfscan registry search <query>  - Search registered connectors by keyword
 * pfscan registry list            - List all connectors with status
 * pfscan registry list --enabled  - Show only enabled connectors
 * pfscan registry list --disabled - Show only disabled connectors
 *
 * Purpose: Enable AI agents to discover and select from pre-registered
 * connectors without external registry access. This provides a controlled
 * whitelist for security.
 */

import { Command } from 'commander';
import { ConfigManager } from '../config/index.js';
import type { Connector } from '../types/index.js';
import { output, getOutputOptions, outputError } from '../utils/output.js';
import { t } from '../i18n/index.js';

/**
 * Connector with computed fields for display
 */
interface ConnectorDisplay extends Connector {
  displayName: string;
  displayType: string;
}

/**
 * Get connectors from config with optional filtering
 */
async function getConnectorsFiltered(
  manager: ConfigManager,
  filter?: 'enabled' | 'disabled'
): Promise<Connector[]> {
  const connectors = await manager.getConnectors();
  if (filter === 'enabled') {
    return connectors.filter(c => c.enabled);
  }
  if (filter === 'disabled') {
    return connectors.filter(c => !c.enabled);
  }
  return connectors;
}

/**
 * Search connectors by keyword (case-insensitive, partial match)
 *
 * Searches in: id, transport type, and command/URL
 *
 * Exported for testing purposes
 */
export function searchConnectors(connectors: Connector[], query: string): Connector[] {
  const lowerQuery = query.toLowerCase();

  return connectors.filter(connector => {
    // Match by ID
    if (connector.id.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    // Match by transport type
    if (connector.transport.type.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    // Match by command (stdio) or URL (http/sse)
    if (connector.transport.type === 'stdio') {
      const cmd = connector.transport.command?.toLowerCase() || '';
      const args = connector.transport.args?.join(' ').toLowerCase() || '';
      if (cmd.includes(lowerQuery) || args.includes(lowerQuery)) {
        return true;
      }
    } else if ('url' in connector.transport && connector.transport.url) {
      if (connector.transport.url.toLowerCase().includes(lowerQuery)) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Format connector for display
 */
function formatConnectorForDisplay(connector: Connector): ConnectorDisplay {
  let displayName = connector.id;
  const displayType = connector.transport.type;

  // Try to derive display name from command (for stdio)
  if (connector.transport.type === 'stdio') {
    const cmd = connector.transport.command || '';
    // Extract package name from common patterns
    // e.g., "npx mcp-server-weather" -> "mcp-server-weather"
    // e.g., "uv run mcp.server" -> "mcp.server"
    const match = cmd.match(/(?:npx|npm|node|uvx|uv|python)\s+([^\s]+)/);
    if (match) {
      displayName = match[1];
    }
  }

  return {
    ...connector,
    displayName,
    displayType,
  };
}

/**
 * Format search results for output
 */
function formatSearchResults(
  connectors: Connector[],
  query: string
): void {
  const opts = getOutputOptions();

  if (opts.json) {
    const results = connectors.map(c => ({
      id: c.id,
      enabled: c.enabled,
      type: c.transport.type,
      displayName: formatConnectorForDisplay(c).displayName,
      transport: {
        command: c.transport.type === 'stdio' ? c.transport.command : undefined,
        url: 'url' in c.transport ? c.transport.url : undefined,
      },
    }));
    output(results);
    return;
  }

  // Human-readable format
  console.log(`${t('registry.searchTitle')} "${query}"`);
  console.log();

  const enabledCount = connectors.filter(c => c.enabled).length;
  const totalCount = connectors.length;

  if (connectors.length === 0) {
    console.log(t('registry.noConnectors'));
    console.log();
    console.log('Tip: pfscan connectors add <id> --stdio "<command>" to add a new connector');
    return;
  }

  for (const connector of connectors) {
    const display = formatConnectorForDisplay(connector);
    const status = connector.enabled ? '' : `[${t('registry.disabled')}]`;
    const typePart = `${t('registry.type')}: ${display.displayType}`;

    // Format transport info
    let transportInfo = '';
    if (connector.transport.type === 'stdio') {
      const cmd = connector.transport.command || '';
      const args = connector.transport.args?.length ? ` ${connector.transport.args.join(' ')}` : '';
      transportInfo = cmd + args;
    } else if ('url' in connector.transport) {
      transportInfo = connector.transport.url;
    }

    console.log(`  ${display.displayName} ${status}`);
    console.log(`    ${typePart}`);
    if (transportInfo) {
      const truncated = transportInfo.length > 50
        ? transportInfo.slice(0, 47) + '...'
        : transportInfo;
      console.log(`    Command: ${truncated}`);
    }
    console.log();
  }

  console.log(`${t('registry.found')} ${totalCount} ${t('registry.connectors')} (${enabledCount} ${t('registry.enabled')}, ${totalCount - enabledCount} ${t('registry.disabled')})`);
  console.log();
  if (totalCount - enabledCount > 0) {
    console.log(t('registry.tipEnable'));
  }
}

/**
 * Format list results for output
 */
function formatListResults(connectors: Connector[]): void {
  const opts = getOutputOptions();

  if (opts.json) {
    const results = connectors.map(c => ({
      id: c.id,
      enabled: c.enabled,
      type: c.transport.type,
      displayName: formatConnectorForDisplay(c).displayName,
      transport: {
        command: c.transport.type === 'stdio' ? c.transport.command : undefined,
        url: 'url' in c.transport ? c.transport.url : undefined,
      },
    }));
    output(results);
    return;
  }

  // Human-readable format
  if (connectors.length === 0) {
    console.log(t('registry.noConnectors'));
    console.log();
    console.log('Tip: pfscan connectors add <id> --stdio "<command>" to add a new connector');
    return;
  }

  const enabledCount = connectors.filter(c => c.enabled).length;
  const totalCount = connectors.length;

  console.log(`${t('registry.listTitle')} ${totalCount} ${t('registry.connectors')} (${enabledCount} ${t('registry.enabled')}, ${totalCount - enabledCount} ${t('registry.disabled')})`);
  console.log();

  for (const connector of connectors) {
    const display = formatConnectorForDisplay(connector);
    const statusBadge = connector.enabled ? `[${t('registry.enabled')}]` : `[${t('registry.disabled')}]`;
    const typePart = `${t('registry.type')}: ${display.displayType}`;

    // Format transport info
    let transportInfo = '';
    if (connector.transport.type === 'stdio') {
      const cmd = connector.transport.command || '';
      const args = connector.transport.args?.length ? ` ${connector.transport.args.join(' ')}` : '';
      transportInfo = cmd + args;
    } else if ('url' in connector.transport) {
      transportInfo = connector.transport.url;
    }

    console.log(`  ${display.displayName} ${statusBadge}`);
    console.log(`    ${typePart}`);
    if (transportInfo) {
      const truncated = transportInfo.length > 50
        ? transportInfo.slice(0, 47) + '...'
        : transportInfo;
      console.log(`    Command: ${truncated}`);
    }
    console.log();
  }

  if (totalCount - enabledCount > 0) {
    console.log(t('registry.tipEnable'));
    console.log(t('registry.tipDisable'));
  }
}

/**
 * Create registry command
 */
export function createRegistryCommand(getConfigPath: () => string): Command {
  const cmd = new Command('registry')
    .description('Search and list locally registered connectors');

  // search subcommand
  cmd
    .command('search')
    .description('Search registered connectors by keyword')
    .argument('<query>', 'Search query (matches ID, type, command, or URL)')
    .action(async (query: string) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const connectors = await getConnectorsFiltered(manager);
        const results = searchConnectors(connectors, query);
        formatSearchResults(results, query);
      } catch (error) {
        outputError('Failed to search connectors', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // list subcommand
  cmd
    .command('list')
    .description('List all connectors with status')
    .option('--enabled', 'Show only enabled connectors')
    .option('--disabled', 'Show only disabled connectors')
    .action(async (options: { enabled?: boolean; disabled?: boolean }) => {
      try {
        // Validate conflicting options
        if (options.enabled && options.disabled) {
          outputError(t('registry.conflictingFlags'));
          process.exit(1);
        }

        const manager = new ConfigManager(getConfigPath());
        let filter: 'enabled' | 'disabled' | undefined;
        if (options.enabled) filter = 'enabled';
        if (options.disabled) filter = 'disabled';

        const connectors = await getConnectorsFiltered(manager, filter);
        formatListResults(connectors);
      } catch (error) {
        outputError('Failed to list connectors', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
