/**
 * Catalog command - MCP Registry operations
 *
 * pfscan catalog search <query>        # Search servers by name/description
 * pfscan catalog view <server> [field] # View server details or specific field
 *
 * Provides access to the MCP server registry for discovering and inspecting
 * available MCP servers.
 */

import { Command } from 'commander';
import {
  RegistryClient,
  RegistryError,
  SUPPORTED_FIELDS,
  isSupportedField,
  getFieldValue,
  formatFieldValue,
  type ServerInfo,
} from '../registry/index.js';
import { output, getOutputOptions } from '../utils/output.js';

/**
 * Format server info as a table row for search results
 */
function formatServerRow(server: ServerInfo): string {
  const name = (server.name || '').padEnd(30).slice(0, 30);
  const version = (server.version || '-').padEnd(12).slice(0, 12);
  const desc = (server.description || '').slice(0, 50);
  return `${name} ${version} ${desc}`;
}

/**
 * Format server info for detailed view
 */
function formatServerDetails(server: ServerInfo): string {
  const lines: string[] = [];

  lines.push(`Name:        ${server.name || '(unknown)'}`);
  lines.push(`Description: ${server.description || '(none)'}`);
  lines.push(`Version:     ${server.version || '(unknown)'}`);

  if (server.versions && server.versions.length > 0) {
    lines.push(`Versions:    ${server.versions.join(', ')}`);
  }

  if (server.repository) {
    lines.push(`Repository:  ${server.repository}`);
  }

  if (server.homepage) {
    lines.push(`Homepage:    ${server.homepage}`);
  }

  if (server.transport) {
    lines.push(`Transport:   ${JSON.stringify(server.transport)}`);
  }

  return lines.join('\n');
}

/**
 * Handle registry errors with user-friendly messages
 */
function handleRegistryError(error: unknown): never {
  if (error instanceof RegistryError) {
    switch (error.code) {
      case 'NETWORK':
        console.error(`Network error: ${error.message}`);
        console.error('Check your internet connection or try again later.');
        break;
      case 'NOT_FOUND':
        console.error(`Server not found.`);
        console.error('Use "pfscan catalog search <query>" to find available servers.');
        break;
      case 'TIMEOUT':
        console.error('Request timed out.');
        console.error('The registry may be slow or unavailable. Try again later.');
        break;
      case 'PARSE':
        console.error('Failed to parse registry response.');
        console.error('The registry API may have changed.');
        break;
      default:
        console.error(`Registry error: ${error.message}`);
    }
  } else if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error('An unknown error occurred.');
  }
  process.exit(1);
}

export function createCatalogCommand(_getConfigPath: () => string): Command {
  const cmd = new Command('catalog')
    .description('Search and view MCP servers from registry');

  // catalog search <query>
  cmd
    .command('search')
    .description('Search for MCP servers by name or description')
    .argument('<query>', 'Search query')
    .action(async (query: string) => {
      const opts = getOutputOptions();
      const client = new RegistryClient();

      try {
        const servers = await client.searchServers(query);

        if (opts.json) {
          output(servers);
          return;
        }

        if (servers.length === 0) {
          console.log(`No servers found matching "${query}".`);
          return;
        }

        // Header
        console.log();
        console.log('NAME'.padEnd(30) + ' ' + 'VERSION'.padEnd(12) + ' DESCRIPTION');
        console.log('-'.repeat(80));

        // Rows
        for (const server of servers) {
          console.log(formatServerRow(server));
        }

        console.log();
        console.log(`${servers.length} server(s) found.`);
        console.log();
        console.log('Tip: Use "pfscan catalog view <name>" for details.');
      } catch (error) {
        handleRegistryError(error);
      }
    });

  // catalog view <server> [field]
  cmd
    .command('view')
    .description('View server details or a specific field')
    .argument('<server>', 'Server name')
    .argument('[field]', 'Specific field to display')
    .action(async (serverName: string, field?: string) => {
      const opts = getOutputOptions();
      const client = new RegistryClient();

      try {
        const server = await client.getServer(serverName);

        if (!server) {
          console.error(`Server not found: ${serverName}`);
          console.error('Use "pfscan catalog search <query>" to find available servers.');
          process.exit(1);
        }

        // If field specified, show only that field
        if (field) {
          if (!isSupportedField(field)) {
            console.error(`Unknown field: ${field}`);
            console.error(`Supported fields: ${SUPPORTED_FIELDS.join(', ')}`);
            process.exit(1);
          }

          const value = getFieldValue(server, field);

          if (opts.json) {
            output({ [field]: value });
            return;
          }

          console.log(formatFieldValue(value));
          return;
        }

        // Show all details
        if (opts.json) {
          output(server);
          return;
        }

        console.log();
        console.log(formatServerDetails(server));
        console.log();
      } catch (error) {
        handleRegistryError(error);
      }
    });

  return cmd;
}
