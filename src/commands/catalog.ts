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
import type { Connector, HttpTransport, StdioTransport } from '../types/index.js';
import {
  getRunner,
  findAvailableRunner,
  parsePackageRef,
  type RunnerName,
} from '../runners/index.js';
import { SqliteSecretStore } from '../secrets/store.js';
import { output, getOutputOptions, outputSuccess, outputError } from '../utils/output.js';
import { isInteractiveTTY } from '../utils/platform.js';
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
 * Spinner options passed from command flags
 */
interface SpinnerFlags {
  spinner?: boolean;
  noSpinner?: boolean;
}

/** Current spinner flags (set by command before createSpinner is called) */
let currentSpinnerFlags: SpinnerFlags = {};

/**
 * Set spinner flags from command options
 * Call this before createSpinner()
 */
function setSpinnerFlags(flags: SpinnerFlags): void {
  currentSpinnerFlags = flags;
}

/**
 * Check if we should show spinner
 * Priority (checked in order, first match wins):
 * 1. --json mode → always false
 * 2. Not interactive TTY → false
 * 3. --spinner flag → true (explicit enable)
 * 4. --no-spinner flag → false (explicit disable)
 * 5. Otherwise → true
 *
 * Note: If both --spinner and --no-spinner are provided, --spinner takes precedence
 * because it is checked first (step 3 before step 4).
 */
function shouldShowSpinner(): boolean {
  const opts = getOutputOptions();

  // --json always disables spinner
  if (opts.json) {
    return false;
  }

  // Must be interactive TTY
  if (!isInteractiveTTY()) {
    return false;
  }

  // --spinner explicitly enables
  if (currentSpinnerFlags.spinner === true) {
    return true;
  }

  // --no-spinner explicitly disables
  if (currentSpinnerFlags.noSpinner === true) {
    return false;
  }

  // Default: enable spinner (CLIXML issue fixed in v0.10.14)
  return true;
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
 * Line 1: NAME (full) + transport badge
 * Line 2: VERSION + truncated DESC
 * Optional: source info for cross-source search
 */
function formatSearchResults(servers: ServerInfoWithSource[], showSource = false): void {
  console.log();

  for (const server of servers) {
    const name = server.name || '(unknown)';
    const version = server.version || '-';
    const desc = server.description || '';
    const transportBadge = getTransportBadge(server);

    // Line 1: Full name + transport badge
    const line1 = transportBadge ? `  ${name}  ${transportBadge}` : `  ${name}`;
    console.log(line1);

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
 * Derive a connector ID from server name
 * Examples:
 *   "@anthropic/claude" -> "claude"
 *   "smithery/hello-world" -> "hello-world"
 *   "my-server" -> "my-server"
 */
function deriveConnectorId(serverName: string): string {
  // Take the last segment after / or @
  const parts = serverName.split(/[/@]/);
  const lastPart = parts[parts.length - 1] || serverName;

  // Sanitize: lowercase, replace non-alphanumeric with hyphen
  return lastPart
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Valid runner names for --runner option
 */
const VALID_RUNNER_NAMES = ['npx', 'uvx'] as const;

/**
 * Check if a runner name is valid
 */
function isValidRunnerName(name: string): name is RunnerName {
  return (VALID_RUNNER_NAMES as readonly string[]).includes(name.toLowerCase());
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

/** Valid transport types for --transport filter */
const VALID_TRANSPORT_TYPES = ['http', 'streamable-http', 'sse', 'stdio'] as const;

/**
 * Check if a transport type is valid
 */
function isValidTransportType(type: string): boolean {
  return (VALID_TRANSPORT_TYPES as readonly string[]).includes(type.toLowerCase());
}

/**
 * Filter servers by transport type
 * Returns only servers that match the specified transport type.
 * Servers with no transport or unknown type are excluded (safe side).
 */
function filterByTransport<T extends ServerInfo>(
  servers: T[],
  transportType: string
): T[] {
  const normalizedType = transportType.toLowerCase();
  return servers.filter((server) => {
    const serverTransport = server.transport?.type?.toLowerCase();
    if (!serverTransport) {
      return false;
    }
    return serverTransport === normalizedType;
  });
}

/**
 * Get transport badge for display
 * Returns a short tag like "[http]" or "[stdio]"
 */
function getTransportBadge(server: ServerInfo): string {
  const type = server.transport?.type?.toLowerCase();
  if (!type) {
    return '';
  }
  // Abbreviate long types for display
  if (type === 'streamable-http') {
    return '[s-http]';
  }
  return `[${type}]`;
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
 * Resolve server name with fallback to similarity search.
 * Shared logic between view and install commands.
 *
 * @returns Resolved server, or exits with error if not found
 */
async function resolveServerWithFallback(
  client: RegistryClient,
  serverName: string,
  currentSource: string,
  sourceOverride: string | undefined,
  opts: { json?: boolean },
  commandTip: string
): Promise<ServerInfo> {
  // First try exact match
  let server = await client.getServer(serverName);

  if (server) {
    return server;
  }

  // Fallback: search and try to resolve
  const searchResults = await client.searchServers(serverName);
  const candidatePool = searchResults.length > 0 ? searchResults : await client.listServers();
  const similar = findSimilarServers(serverName, candidatePool);

  if (similar.length === 0) {
    // No suggestions available
    if (opts.json) {
      output({
        error: 'Server not found',
        query: serverName,
        source: sourceOverride || currentSource,
      });
    } else {
      showNotFoundGuidance(serverName, currentSource, false, sourceOverride);
    }
    process.exit(1);
  }

  if (similar.length === 1) {
    // Single match - auto-resolve
    server = similar[0];
    if (!opts.json) {
      console.error(`Resolved "${serverName}" \u2192 ${server.name}`);
    }
    return server;
  }

  // Multiple candidates - show did-you-mean
  if (opts.json) {
    output({
      error: 'Multiple matches found',
      query: serverName,
      candidates: similar.map((s) => s.name),
    });
  } else {
    console.error(`Server not found: ${serverName} (source: ${sourceOverride || currentSource})`);
    console.error();
    console.error('Did you mean:');
    console.error(formatCandidates(similar));
    console.error();
    console.error(`Tip: ${commandTip}`);
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
    .option('--transport <type>', 'Filter by transport type (http, streamable-http, sse, stdio)')
    .option('--spinner', 'Show spinner (experimental on Windows/PowerShell)')
    .option('--no-spinner', 'Disable spinner')
    .action(async (query: string, options: { source?: string; all?: boolean; transport?: string; spinner?: boolean; noSpinner?: boolean }) => {
      // Set spinner flags before any spinner operations
      setSpinnerFlags({ spinner: options.spinner, noSpinner: options.noSpinner });
      const opts = getOutputOptions();
      const currentSource = await getEffectiveSource(getConfigPath);

      // Validate transport type if specified
      if (options.transport && !isValidTransportType(options.transport)) {
        if (opts.json) {
          output({ error: `Invalid transport type: ${options.transport}`, validTypes: [...VALID_TRANSPORT_TYPES] });
        } else {
          outputError(`Invalid transport type: ${options.transport}`);
          console.error(`Valid types: ${VALID_TRANSPORT_TYPES.join(', ')}`);
        }
        process.exit(1);
      }

      // Cross-source search with --all
      if (options.all) {
        const spinner = createSpinner(`Searching all sources for "${query}"...`);

        try {
          spinner?.start();
          let { servers, warnings } = await searchAllSources(query, spinner);

          // Apply transport filter if specified
          if (options.transport) {
            servers = filterByTransport(servers, options.transport);
          }

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
        let servers = await client.searchServers(query);

        // Apply transport filter if specified
        if (options.transport) {
          servers = filterByTransport(servers, options.transport);
        }

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
    .option('--spinner', 'Show spinner (experimental on Windows/PowerShell)')
    .option('--no-spinner', 'Disable spinner')
    .action(async (serverName: string, field: string | undefined, options: { source?: string; spinner?: boolean; noSpinner?: boolean }) => {
      // Set spinner flags before any spinner operations
      setSpinnerFlags({ spinner: options.spinner, noSpinner: options.noSpinner });
      const opts = getOutputOptions();
      const currentSource = await getEffectiveSource(getConfigPath);
      const spinner = createSpinner(`Fetching "${serverName}"...`);

      try {
        const client = await createClientForSource(getConfigPath, options.source);
        spinner?.start();

        // Resolve server with fallback to similarity search
        const server = await resolveServerWithFallback(
          client,
          serverName,
          currentSource,
          options.source,
          opts,
          'pfscan cat view <full-name>'
        );

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

  // catalog install <server>
  cmd
    .command('install')
    .description('Install MCP server from catalog to connectors')
    .argument('<server>', 'Server name from catalog')
    .option('--source <name>', 'Use specific catalog source')
    .option('--dry-run', 'Show what would be added without modifying config')
    .option('--name <id>', 'Override connector ID')
    .option('--runner <name>', 'Package runner to use for stdio servers (npx, uvx)')
    .option('--spinner', 'Show spinner')
    .option('--no-spinner', 'Disable spinner')
    .action(async (serverName: string, options: {
      source?: string;
      dryRun?: boolean;
      name?: string;
      runner?: string;
      spinner?: boolean;
      noSpinner?: boolean;
    }) => {
      setSpinnerFlags({ spinner: options.spinner, noSpinner: options.noSpinner });
      const opts = getOutputOptions();
      const currentSource = await getEffectiveSource(getConfigPath);
      const spinner = createSpinner(`Fetching "${serverName}"...`);

      try {
        const client = await createClientForSource(getConfigPath, options.source);
        spinner?.start();

        // Resolve server with fallback to similarity search
        const server = await resolveServerWithFallback(
          client,
          serverName,
          currentSource,
          options.source,
          opts,
          'pfscan cat install <full-name>'
        );

        stopSpinner(spinner);

        // Validate transport
        const transport = server.transport;
        if (!transport) {
          if (opts.json) {
            output({ error: 'No transport configuration found', server: server.name });
          } else {
            outputError(`Server "${server.name}" has no transport configuration.`);
            console.error('This server may require manual configuration.');
          }
          process.exit(1);
        }

        // Validate transport type exists
        if (!transport.type) {
          if (opts.json) {
            output({ error: 'Transport type not specified', server: server.name });
          } else {
            outputError(`Server "${server.name}" has transport but no type specified.`);
          }
          process.exit(1);
        }

        const transportType = transport.type.toLowerCase();

        // Generate connector ID
        const connectorId = options.name || deriveConnectorId(server.name);

        // ConfigManager for all paths
        const manager = new ConfigManager(getConfigPath());

        // Check for ID collision before attempting to add
        const existing = await manager.getConnector(connectorId).catch(() => null);
        if (existing) {
          if (opts.json) {
            output({ error: `Connector ID already exists: ${connectorId}`, suggestion: 'Use --name to specify different ID' });
          } else {
            outputError(`Connector ID already exists: ${connectorId}`);
            console.error();
            console.error('Use --name to specify a different ID:');
            console.error(`  pfscan cat install "${server.name}" --name ${connectorId}-2`);
          }
          process.exit(1);
        }

        let connector: Connector;
        let runnerUsed: string | undefined;

        // Handle stdio transport with runner
        if (transportType === 'stdio') {
          // Parse package reference from catalog transport
          const pkgRef = parsePackageRef(transport);

          if (!pkgRef) {
            if (opts.json) {
              output({
                error: 'Cannot parse package reference from transport',
                server: server.name,
                transport,
              });
            } else {
              outputError('Cannot parse package reference from transport config.');
              console.error();
              console.error('This server may require manual configuration:');
              console.error(`  pfscan connectors add ${deriveConnectorId(server.name)} --stdio "<command>"`);
            }
            process.exit(1);
          }

          // Determine runner to use
          let runner;

          if (options.runner) {
            // --runner specified: validate and use that runner
            if (!isValidRunnerName(options.runner)) {
              if (opts.json) {
                output({
                  error: `Invalid runner: ${options.runner}`,
                  validRunners: [...VALID_RUNNER_NAMES],
                });
              } else {
                outputError(`Invalid runner: ${options.runner}`);
                console.error(`Valid runners: ${VALID_RUNNER_NAMES.join(', ')}`);
              }
              process.exit(1);
            }

            runner = getRunner(options.runner as RunnerName);
            const status = await runner.detect();

            if (!status.available) {
              if (opts.json) {
                output({
                  error: `Runner not available: ${options.runner}`,
                  status,
                });
              } else {
                outputError(`Runner '${options.runner}' is not available.`);
                if (status.error) {
                  console.error(`  Error: ${status.error}`);
                }
                console.error();
                console.error('Run diagnostics:');
                console.error('  pfscan runners doctor');
              }
              process.exit(1);
            }
          } else {
            // No --runner specified: auto-select (npx > uvx)
            runner = await findAvailableRunner();

            if (!runner) {
              if (opts.json) {
                output({
                  error: 'No package runner available',
                  suggestion: 'Install npm (for npx) or uv (for uvx)',
                });
              } else {
                outputError('No package runner available.');
                console.error();
                console.error('Install one of the following:');
                console.error('  - npm (provides npx): https://nodejs.org');
                console.error('  - uv (provides uvx): https://github.com/astral-sh/uv');
                console.error();
                console.error('Then run diagnostics:');
                console.error('  pfscan runners doctor');
              }
              process.exit(1);
            }
          }

          // Materialize transport
          const materialized = runner.materialize(pkgRef, transport.env);
          runnerUsed = runner.name;

          // Build stdio connector config
          connector = {
            id: connectorId,
            enabled: true,
            transport: {
              type: 'stdio',
              command: materialized.command,
              args: materialized.args,
              ...(materialized.env && { env: materialized.env }),
            } as StdioTransport,
          };
        } else {
          // Handle HTTP transports
          const isHttpTransport = transportType === 'http' || transportType === 'streamable-http';
          if (!isHttpTransport) {
            if (opts.json) {
              output({ error: `Unsupported transport type: ${transportType}`, server: server.name });
            } else {
              outputError(`Unsupported transport type: ${transportType}`);
              console.error('Supported types: http, streamable-http, stdio');
            }
            process.exit(1);
          }

          // Validate URL exists and is well-formed
          if (!transport.url) {
            if (opts.json) {
              output({ error: 'Transport missing URL', server: server.name });
            } else {
              outputError(`Server "${server.name}" has ${transportType} transport but no URL.`);
            }
            process.exit(1);
          }

          // Validate URL format
          try {
            new URL(transport.url);
          } catch {
            if (opts.json) {
              output({ error: 'Invalid URL format', url: transport.url, server: server.name });
            } else {
              outputError(`Invalid URL format: ${transport.url}`);
            }
            process.exit(1);
          }

          // Build HTTP connector config
          connector = {
            id: connectorId,
            enabled: true,
            transport: {
              type: 'rpc-http',
              url: transport.url,
            } as HttpTransport,
          };
        }

        // Dry run: show what would be added
        if (options.dryRun) {
          if (opts.json) {
            output({
              dryRun: true,
              connector,
              ...(runnerUsed && { runner: runnerUsed }),
            });
          } else {
            if (runnerUsed) {
              console.log(`Would add connector (using ${runnerUsed}):`);
            } else {
              console.log('Would add connector:');
            }
            console.log(JSON.stringify(connector, null, 2));
            console.log();
            console.error('(dry-run mode, no changes made)');
          }
          return;
        }

        // Add connector
        await manager.addConnector(connector);

        if (opts.json) {
          output({
            success: true,
            connector,
            ...(runnerUsed && { runner: runnerUsed }),
          });
        } else {
          if (runnerUsed) {
            outputSuccess(`Connector '${connectorId}' added from ${server.name} (via ${runnerUsed})`);
          } else {
            outputSuccess(`Connector '${connectorId}' added from ${server.name}`);
          }
          console.log();
          console.log('Next steps:');
          console.log(`  pfscan scan start --id ${connectorId}`);
        }
      } catch (error) {
        stopSpinner(spinner);
        handleRegistryError(error);
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
