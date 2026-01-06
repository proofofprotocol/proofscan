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
import ora, { type Ora } from 'ora';
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

/** Braille spinner frames */
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Terminal width for formatting (fallback to 80) */
const TERM_WIDTH = process.stdout.columns || 80;

/**
 * Check if we should show spinner
 * - Only in TTY
 * - Not in --json mode
 * - Not in --verbose mode
 */
function shouldShowSpinner(): boolean {
  const opts = getOutputOptions();
  return process.stdout.isTTY === true && !opts.json && !opts.verbose;
}

/**
 * Create a braille spinner with SIGINT handling
 */
function createSpinner(text: string): Ora | null {
  if (!shouldShowSpinner()) {
    return null;
  }

  const spinner = ora({
    text,
    spinner: {
      frames: BRAILLE_FRAMES,
      interval: 80,
    },
  });

  // Handle SIGINT to stop spinner gracefully
  const sigintHandler = () => {
    spinner.stop();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  // Store handler for cleanup
  (spinner as Ora & { _sigintHandler?: () => void })._sigintHandler = sigintHandler;

  return spinner;
}

/**
 * Stop spinner and clean up SIGINT handler
 */
function stopSpinner(spinner: Ora | null): void {
  if (spinner) {
    const handler = (spinner as Ora & { _sigintHandler?: () => void })._sigintHandler;
    if (handler) {
      process.removeListener('SIGINT', handler);
    }
    spinner.stop();
  }
}

/**
 * Format search results with two-line format
 * Line 1: NAME (full)
 * Line 2: VERSION + truncated DESC
 */
function formatSearchResults(servers: ServerInfo[]): void {
  console.log();

  for (const server of servers) {
    const name = server.name || '(unknown)';
    const version = server.version || '-';
    const desc = server.description || '';

    // Line 1: Full name
    console.log(`  ${name}`);

    // Line 2: version + description (truncated to fit)
    const versionPart = `    v${version}`;
    const maxDescLen = TERM_WIDTH - versionPart.length - 4; // 4 for padding/ellipsis
    const truncatedDesc = desc.length > maxDescLen
      ? desc.slice(0, maxDescLen - 1) + '…'
      : desc;
    console.log(`${versionPart}  ${truncatedDesc}`);
    console.log(); // blank line between entries
  }
}

/**
 * Find similar servers for did-you-mean suggestions
 * Uses already-fetched server list to avoid extra network calls
 */
function findSimilarServers(query: string, servers: ServerInfo[], maxResults = 5): ServerInfo[] {
  const lowerQuery = query.toLowerCase();

  // Score servers by similarity
  const scored = servers.map((server) => {
    const name = server.name?.toLowerCase() || '';
    const desc = server.description?.toLowerCase() || '';

    let score = 0;

    // Exact substring match in name (highest)
    if (name.includes(lowerQuery)) {
      score += 100;
    }

    // Substring match in description
    if (desc.includes(lowerQuery)) {
      score += 50;
    }

    // Prefix match on short name (e.g., query "ex" matches "ai.exa/exa")
    const shortName = name.split('/').pop() || name;
    if (shortName.startsWith(lowerQuery)) {
      score += 80;
    }

    // Contains any query word
    const queryWords = lowerQuery.split(/\s+/);
    for (const word of queryWords) {
      if (word.length >= 2 && (name.includes(word) || desc.includes(word))) {
        score += 20;
      }
    }

    return { server, score };
  });

  // Return top matches with score > 0
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.server);
}

/**
 * Format candidate servers for selection prompt
 */
function formatCandidates(servers: ServerInfo[]): string {
  const lines: string[] = [];
  for (let i = 0; i < servers.length; i++) {
    const s = servers[i];
    const shortDesc = s.description
      ? s.description.slice(0, 50) + (s.description.length > 50 ? '…' : '')
      : '';
    lines.push(`  ${i + 1}. ${s.name}${shortDesc ? ` - ${shortDesc}` : ''}`);
  }
  return lines.join('\n');
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
      const spinner = createSpinner(`Searching for "${query}"...`);

      try {
        spinner?.start();
        const servers = await client.searchServers(query);
        stopSpinner(spinner);

        if (opts.json) {
          output(servers);
          return;
        }

        if (servers.length === 0) {
          console.log(`No servers found matching "${query}".`);
          return;
        }

        // Two-line format with full NAME
        formatSearchResults(servers);

        console.log(`${servers.length} server(s) found.`);
        console.log();
        console.log('Tip: pfscan catalog view <name>');
      } catch (error) {
        stopSpinner(spinner);
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
      const spinner = createSpinner(`Fetching "${serverName}"...`);

      try {
        spinner?.start();
        let server = await client.getServer(serverName);

        // Fallback: if not found, search and try to resolve
        if (!server) {
          // Get all servers for similarity search
          const allServers = await client.listServers();
          const similar = findSimilarServers(serverName, allServers);

          stopSpinner(spinner);

          if (similar.length === 0) {
            // No suggestions available
            console.error(`Server not found: ${serverName}`);
            console.error('Use "pfscan catalog search <query>" to find available servers.');
            process.exit(1);
          }

          if (similar.length === 1) {
            // Single match - auto-resolve
            server = similar[0];
            console.log(`Resolved "${serverName}" → ${server.name}`);
            console.log();
          } else {
            // Multiple candidates - show did-you-mean
            console.error(`Server not found: ${serverName}`);
            console.error();
            console.error('Did you mean:');
            console.error(formatCandidates(similar));
            console.error();
            console.error('Tip: pfscan catalog view <full-name>');
            process.exit(1);
          }
        } else {
          stopSpinner(spinner);
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
        stopSpinner(spinner);
        handleRegistryError(error);
      }
    });

  return cmd;
}
