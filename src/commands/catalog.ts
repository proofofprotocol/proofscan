/**
 * Catalog command - MCP Registry operations
 *
 * pfscan catalog search <query>        # Search servers by name/description
 * pfscan catalog search <query> --all  # Cross-source search
 * pfscan catalog view <server> [field] # View server details or specific field
 * pfscan catalog sources               # Show available catalog sources
 * pfscan catalog sources list          # Same as sources
 * pfscan catalog sources set <name>    # Set default catalog source
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
  CATALOG_SOURCES,
  DEFAULT_CATALOG_SOURCE,
  getSource,
  isValidSource,
  getSourceNames,
  isSourceReady,
  getAuthErrorMessage,
  formatSourceLine,
  setSecretResolver,
  getSourceApiKey,
} from '../registry/index.js';
import { ConfigManager } from '../config/index.js';
import { SqliteSecretStore } from '../secrets/store.js';
import { output, getOutputOptions, outputSuccess, outputError } from '../utils/output.js';
import { dirname } from 'path';

/** Braille spinner frames */
const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Terminal width for formatting (fallback to 80) */
const TERM_WIDTH = process.stdout.columns || 80;

/**
 * Extended ServerInfo with source information for cross-source search
 */
interface ServerInfoWithSource extends ServerInfo {
  _source?: string;
}

/**
 * Check if we should show spinner
 * - Only when stderr is TTY (human watching terminal)
 * - Not in --json mode
 * - Not in --verbose mode
 * - Not when stdin is piped (automated use)
 */
function shouldShowSpinner(): boolean {
  const opts = getOutputOptions();
  // Spinner goes to stderr, so check stderr TTY
  // Also skip if stdin is piped (non-interactive use)
  const isInteractive = process.stderr.isTTY === true && process.stdin.isTTY !== false;
  return isInteractive && !opts.json && !opts.verbose;
}

/**
 * Create a braille spinner with SIGINT handling
 * Output goes to stderr to keep stdout clean for data
 */
function createSpinner(text: string): Ora | null {
  if (!shouldShowSpinner()) {
    return null;
  }

  const spinner = ora({
    text,
    stream: process.stderr, // Output to stderr, not stdout
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
  process.once('SIGINT', sigintHandler);

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
 * Get the effective catalog source from config or default
 * Priority: 1) config.catalog.defaultSource, 2) DEFAULT_CATALOG_SOURCE
 */
async function getEffectiveSource(getConfigPath: () => string): Promise<string> {
  try {
    const manager = new ConfigManager(getConfigPath());
    const config = await manager.loadOrDefault();
    return config.catalog?.defaultSource || DEFAULT_CATALOG_SOURCE;
  } catch {
    return DEFAULT_CATALOG_SOURCE;
  }
}

/**
 * Initialize the secret resolver for catalog sources
 * This connects the registry module to the pfscan secrets system
 */
async function initSecretResolver(getConfigPath: () => string): Promise<void> {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  setSecretResolver(async (secretKey: string): Promise<string | undefined> => {
    try {
      // Load config to get the secret reference
      const manager = new ConfigManager(configPath);
      const config = await manager.loadOrDefault();

      // Look up the secret reference in config.catalog.secrets
      const secretRef = config.catalog?.secrets?.[secretKey];
      if (!secretRef) {
        return undefined;
      }

      // Parse secretRef (e.g., "dpapi:uuid" or "plain:uuid")
      const match = secretRef.match(/^[^:]+:(.+)$/);
      if (!match) {
        return undefined;
      }

      const secretId = match[1];

      // Retrieve from secret store
      const store = new SqliteSecretStore(configDir);
      try {
        return await store.retrieve(secretId) ?? undefined;
      } finally {
        store.close();
      }
    } catch {
      return undefined;
    }
  });
}

/**
 * Create a RegistryClient for the effective source
 * Validates source and checks authentication
 */
async function createClientForSource(
  getConfigPath: () => string,
  sourceOverride?: string
): Promise<RegistryClient> {
  const sourceName = sourceOverride || (await getEffectiveSource(getConfigPath));
  const source = getSource(sourceName);

  if (!source) {
    throw new Error(`Unknown catalog source: ${sourceName}`);
  }

  if (!isSourceReady(source)) {
    throw new Error(getAuthErrorMessage(source));
  }

  // Get API key if source requires auth
  const apiKey = await getSourceApiKey(source);

  // For auth-required sources, check if we actually have the API key
  if (source.authRequired && !apiKey) {
    throw new Error(getAuthErrorMessage(source));
  }

  return new RegistryClient({ baseUrl: source.baseUrl, apiKey });
}

/**
 * Cross-source search: search all available sources in parallel and merge results
 */
async function searchAllSources(
  query: string,
  spinner: Ora | null
): Promise<{ servers: ServerInfoWithSource[]; skipped: string[]; warnings: string[] }> {
  const allServers: ServerInfoWithSource[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const seenNames = new Set<string>();

  // Check each source and get API keys for auth-required sources
  const sourcePromises = CATALOG_SOURCES.map(async (source) => {
    if (!isSourceReady(source)) {
      return { source, ready: false, apiKey: undefined };
    }
    // Get API key for auth-required sources
    const apiKey = await getSourceApiKey(source);
    if (source.authRequired && !apiKey) {
      return { source, ready: false, apiKey: undefined };
    }
    return { source, ready: true, apiKey };
  });

  const sourceResults = await Promise.all(sourcePromises);

  // Separate ready and not-ready sources
  const readySources: { source: typeof CATALOG_SOURCES[0]; apiKey?: string }[] = [];
  for (const result of sourceResults) {
    if (!result.ready) {
      skipped.push(result.source.name);
      warnings.push(`(${result.source.name} skipped: API key not set)`);
    } else {
      readySources.push({ source: result.source, apiKey: result.apiKey });
    }
  }

  // Update spinner text for parallel search
  if (spinner) {
    spinner.text = `Searching ${readySources.length} source(s)...`;
  }

  // Search all ready sources in parallel
  const searchPromises = readySources.map(async ({ source, apiKey }) => {
    try {
      const client = new RegistryClient({ baseUrl: source.baseUrl, apiKey });
      const servers = await client.searchServers(query);
      return { source: source.name, servers, error: null };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { source: source.name, servers: [] as ServerInfo[], error: msg };
    }
  });

  const results = await Promise.all(searchPromises);

  // Merge results and collect warnings
  for (const result of results) {
    if (result.error) {
      warnings.push(`(${result.source} error: ${result.error})`);
      continue;
    }

    // Add source info and deduplicate by name
    for (const server of result.servers) {
      const key = server.name || server.repository || JSON.stringify(server);
      if (!seenNames.has(key)) {
        seenNames.add(key);
        allServers.push({ ...server, _source: result.source });
      }
    }
  }

  return { servers: allServers, skipped, warnings };
}

/**
 * Format search results with two-line format
 * Line 1: NAME (full)
 * Line 2: VERSION + truncated DESC
 * Optional: source info for cross-source search
 */
function formatSearchResults(servers: ServerInfoWithSource[], showSource = false): void {
  console.log();

  for (const server of servers) {
    const name = server.name || '(unknown)';
    const version = server.version || '-';
    const desc = server.description || '';

    // Line 1: Full name
    console.log(`  ${name}`);

    // Line 2: version + description (truncated to fit)
    const versionPart = `    v${version}`;
    const sourceInfo = showSource && server._source ? `  [${server._source}]` : '';
    const maxDescLen = TERM_WIDTH - versionPart.length - sourceInfo.length - 4;
    const truncatedDesc =
      desc.length > maxDescLen ? desc.slice(0, maxDescLen - 1) + '…' : desc;
    console.log(`${versionPart}  ${truncatedDesc}${sourceInfo}`);
    console.log(); // blank line between entries
  }
}

/**
 * Find similar servers for did-you-mean suggestions
 * Uses already-fetched server list to avoid extra network calls
 */
function findSimilarServers(
  query: string,
  servers: ServerInfo[],
  maxResults = 5
): ServerInfo[] {
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
 * Show not-found guidance with source info
 */
function showNotFoundGuidance(
  query: string,
  currentSource: string,
  useAll: boolean,
  sourceOverride?: string
): void {
  const effectiveSource = sourceOverride || currentSource;
  console.error(`Server not found: ${query} (source: ${effectiveSource})`);
  console.error();
  console.error('Try one of the following:');

  // Show --all first if not already using it
  if (!useAll) {
    console.error(`  pfscan cat search ${query} --all`);
  }

  // Show alternative sources
  for (const source of CATALOG_SOURCES) {
    if (source.name !== effectiveSource) {
      console.error(`  pfscan cat search ${query} --source ${source.name}`);
    }
  }

  // Show source switch command
  if (!sourceOverride && currentSource !== 'smithery') {
    console.error(`  pfscan cat sources set smithery`);
  }
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

/**
 * Show sources list (shared by 'sources' and 'sources list')
 */
async function showSourcesList(getConfigPath: () => string): Promise<void> {
  const opts = getOutputOptions();
  const defaultSource = await getEffectiveSource(getConfigPath);

  if (opts.json) {
    output({
      defaultSource,
      sources: CATALOG_SOURCES.map((s) => ({
        name: s.name,
        baseUrl: s.baseUrl,
        authRequired: s.authRequired,
        secretKey: s.secretKey,
        ready: isSourceReady(s),
      })),
    });
    return;
  }

  console.log(`Default catalog source: ${defaultSource}`);
  console.log();
  console.log('Sources:');
  for (const source of CATALOG_SOURCES) {
    const isDefault = source.name === defaultSource;
    console.log(formatSourceLine(source, isDefault));
  }
  console.log();
  console.log('Tip: pfscan cat sources set <name>');
}

export function createCatalogCommand(getConfigPath: () => string): Command {
  const cmd = new Command('catalog').description(
    'Search and view MCP servers from registry'
  );

  // Initialize secret resolver before any command action
  cmd.hook('preAction', async () => {
    await initSecretResolver(getConfigPath);
  });

  // catalog search <query>
  cmd
    .command('search')
    .description('Search for MCP servers by name or description')
    .argument('<query>', 'Search query')
    .option('--source <name>', 'Use specific catalog source')
    .option('--all', 'Search all available catalog sources')
    .action(async (query: string, options: { source?: string; all?: boolean }) => {
      const opts = getOutputOptions();
      const currentSource = await getEffectiveSource(getConfigPath);

      // Cross-source search with --all
      if (options.all) {
        const spinner = createSpinner(`Searching all sources for "${query}"...`);

        try {
          spinner?.start();
          const { servers, warnings } = await searchAllSources(query, spinner);

          if (opts.json) {
            output(servers.map((s) => ({ ...s, source: s._source })));
            return;
          }

          // Show warnings for skipped sources (to stderr)
          for (const warning of warnings) {
            console.error(warning);
          }

          if (servers.length === 0) {
            console.log(`No servers found matching "${query}" across all sources.`);
            return;
          }

          // Two-line format with source info
          formatSearchResults(servers, true);

          console.log(`${servers.length} server(s) found across sources.`);
          console.log();

          // Improved Tip: embed full ID if single result
          if (servers.length === 1 && servers[0].name) {
            console.log(`Tip: pfscan cat view "${servers[0].name}"`);
          } else {
            console.log('Tip: pfscan cat view <name>');
          }
        } catch (error) {
          handleRegistryError(error);
        } finally {
          stopSpinner(spinner);
        }
        return;
      }

      // Single source search
      const spinner = createSpinner(`Searching for "${query}"...`);

      try {
        const client = await createClientForSource(getConfigPath, options.source);
        spinner?.start();
        const servers = await client.searchServers(query);

        if (opts.json) {
          output(servers);
          return;
        }

        if (servers.length === 0) {
          console.log(`No servers found matching "${query}" (source: ${options.source || currentSource}).`);
          console.log();
          console.log('Try searching all sources:');
          console.log(`  pfscan cat search ${query} --all`);
          return;
        }

        // Two-line format with full NAME
        formatSearchResults(servers);

        console.log(`${servers.length} server(s) found.`);
        console.log();

        // Improved Tip: embed full ID if single result
        if (servers.length === 1 && servers[0].name) {
          console.log(`Tip: pfscan cat view "${servers[0].name}"`);
        } else {
          console.log('Tip: pfscan cat view <name>');
        }
      } catch (error) {
        handleRegistryError(error);
      } finally {
        stopSpinner(spinner);
      }
    });

  // catalog view <server> [field]
  cmd
    .command('view')
    .description('View server details or a specific field')
    .argument('<server>', 'Server name')
    .argument('[field]', 'Specific field to display')
    .option('--source <name>', 'Use specific catalog source')
    .action(async (serverName: string, field: string | undefined, options: { source?: string }) => {
      const opts = getOutputOptions();
      const currentSource = await getEffectiveSource(getConfigPath);
      const spinner = createSpinner(`Fetching "${serverName}"...`);

      try {
        const client = await createClientForSource(getConfigPath, options.source);
        spinner?.start();
        let server = await client.getServer(serverName);

        // Fallback: if not found, search and try to resolve
        if (!server) {
          // Get all servers for similarity search
          const allServers = await client.listServers();
          const similar = findSimilarServers(serverName, allServers);

          if (similar.length === 0) {
            // No suggestions available - show enhanced guidance
            if (opts.json) {
              output({
                error: 'Server not found',
                query: serverName,
                source: options.source || currentSource,
              });
            } else {
              showNotFoundGuidance(serverName, currentSource, false, options.source);
            }
            process.exit(1);
          }

          if (similar.length === 1) {
            // Single match - auto-resolve
            server = similar[0];
            console.log(`Resolved "${serverName}" → ${server.name}`);
            console.log();
          } else {
            // Multiple candidates - show did-you-mean
            console.error(`Server not found: ${serverName} (source: ${options.source || currentSource})`);
            console.error();
            console.error('Did you mean:');
            console.error(formatCandidates(similar));
            console.error();
            console.error('Tip: pfscan cat view <full-name>');
            process.exit(1);
          }
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
      } finally {
        stopSpinner(spinner);
      }
    });

  // catalog sources - show available sources
  const sourcesCmd = cmd
    .command('sources')
    .description('Manage catalog sources');

  // Default action for 'sources' (no subcommand)
  sourcesCmd.action(async () => {
    await showSourcesList(getConfigPath);
  });

  // catalog sources list - explicit list subcommand
  sourcesCmd
    .command('list')
    .description('List available catalog sources')
    .action(async () => {
      await showSourcesList(getConfigPath);
    });

  // catalog sources set <name> - set default source
  sourcesCmd
    .command('set')
    .description('Set default catalog source')
    .argument('<name>', 'Source name')
    .action(async (name: string) => {
      const opts = getOutputOptions();

      // Validate source name
      if (!isValidSource(name)) {
        if (opts.json) {
          output({ success: false, error: `Unknown catalog source: ${name}` });
        } else {
          outputError(`Unknown catalog source: ${name}`);
          console.error();
          console.error('Available sources:');
          for (const sourceName of getSourceNames()) {
            console.error(`  ${sourceName}`);
          }
        }
        process.exit(1);
      }

      try {
        const manager = new ConfigManager(getConfigPath());
        const config = await manager.loadOrDefault();

        // Update catalog config
        config.catalog = config.catalog || {};
        config.catalog.defaultSource = name;

        await manager.save(config);

        if (opts.json) {
          output({ success: true, defaultSource: name });
        } else {
          outputSuccess(`Default catalog source set to: ${name}`);
        }
      } catch (error) {
        if (opts.json) {
          output({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        } else {
          outputError(
            'Failed to save config',
            error instanceof Error ? error : undefined
          );
        }
        process.exit(1);
      }
    });

  return cmd;
}
