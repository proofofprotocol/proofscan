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
import { dirname } from 'path';
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
  type CatalogSource,
} from '../registry/index.js';
import { ConfigManager } from '../config/index.js';
import { output, getOutputOptions, outputSuccess, outputError } from '../utils/output.js';
import { SqliteSecretStore } from '../secrets/index.js';

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
 * Initialize secret resolver for catalog sources
 * This connects sources.ts to the pfscan secret store
 */
function initSecretResolver(getConfigPath: () => string): void {
  setSecretResolver(async (secretKey: string) => {
    try {
      const configPath = getConfigPath();
      const configDir = dirname(configPath);
      const manager = new ConfigManager(configPath);
      const config = await manager.loadOrDefault();

      // Look up the secret reference from config.catalog.secrets
      const secretRef = config.catalog?.secrets?.[secretKey];
      if (!secretRef) {
        return undefined;
      }

      // Resolve the secret from the store
      const store = new SqliteSecretStore(configDir);
      try {
        // Parse the reference to get the ID (e.g., "dpapi:abc123" -> "abc123")
        const match = secretRef.match(/^[^:]+:(.+)$/);
        if (!match) {
          return undefined;
        }
        const secretId = match[1];
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
  // Initialize secret resolver on first use
  initSecretResolver(getConfigPath);

  const sourceName = sourceOverride || (await getEffectiveSource(getConfigPath));
  const source = getSource(sourceName);

  if (!source) {
    throw new Error(`Unknown catalog source: ${sourceName}`);
  }

  if (!isSourceReady(source)) {
    throw new Error(getAuthErrorMessage(source));
  }

  // Get API key for authenticated sources
  const apiKey = await getSourceApiKey(source);

  // For auth-required sources, verify we have the API key
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
  spinner: Ora | null,
  getConfigPath: () => string
): Promise<{ servers: ServerInfoWithSource[]; skipped: string[]; warnings: string[] }> {
  const allServers: ServerInfoWithSource[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const seenNames = new Set<string>();

  // Initialize secret resolver for authenticated sources
  initSecretResolver(getConfigPath);

  // Prepare sources with async API key resolution
  const sourcePrep = await Promise.all(
    CATALOG_SOURCES.map(async (source) => {
      if (!isSourceReady(source)) {
        return { source, ready: false, apiKey: undefined, skipReason: 'not configured' };
      }

      // For auth-required sources, try to get the API key
      if (source.authRequired) {
        const apiKey = await getSourceApiKey(source);
        if (!apiKey) {
          return { source, ready: false, apiKey: undefined, skipReason: `API key not set (use: pfscan secret set ${source.secretKey})` };
        }
        return { source, ready: true, apiKey };
      }

      return { source, ready: true, apiKey: undefined };
    })
  );

  // Separate ready and not-ready sources
  const readySources: Array<{ source: CatalogSource; apiKey?: string }> = [];
  for (const prep of sourcePrep) {
    if (!prep.ready) {
      skipped.push(prep.source.name);
      warnings.push(`(${prep.source.name} skipped: ${prep.skipReason})`);
    } else {
      readySources.push({ source: prep.source, apiKey: prep.apiKey });
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
          const { servers, warnings } = await searchAllSources(query, spinner, getConfigPath);
          stopSpinner(spinner);

          if (opts.json) {
            output(servers.map((s) => ({ ...s, source: s._source })));
            return;
          }

          // Show warnings for skipped sources
          for (const warning of warnings) {
            console.log(warning);
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
          stopSpinner(spinner);
          handleRegistryError(error);
        }
        return;
      }

      // Single source search
      const spinner = createSpinner(`Searching for "${query}"...`);

      try {
        const client = await createClientForSource(getConfigPath, options.source);
        spinner?.start();
        const servers = await client.searchServers(query);
        stopSpinner(spinner);

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

          stopSpinner(spinner);

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

  // catalog sources secret <source> - set API key for authenticated source
  sourcesCmd
    .command('secret')
    .description('Set API key for an authenticated catalog source')
    .argument('<source>', 'Source name (e.g., smithery)')
    .option('--clip', 'Read API key from clipboard instead of prompting')
    .action(async (sourceName: string, options: { clip?: boolean }) => {
      const opts = getOutputOptions();
      const { readSecretHidden, readSecretFromClipboard } = await import('../utils/secret-input.js');

      // Validate source
      const source = getSource(sourceName);
      if (!source) {
        if (opts.json) {
          output({ success: false, error: `Unknown catalog source: ${sourceName}` });
        } else {
          outputError(`Unknown catalog source: ${sourceName}`);
          console.error();
          console.error('Available sources:');
          for (const name of getSourceNames()) {
            console.error(`  ${name}`);
          }
        }
        process.exit(1);
      }

      // Check if source requires auth
      if (!source.authRequired) {
        if (opts.json) {
          output({ success: false, error: `${sourceName} does not require authentication` });
        } else {
          outputError(`${sourceName} does not require authentication`);
        }
        process.exit(1);
      }

      // Read API key
      let apiKey: string;
      try {
        if (options.clip) {
          console.log(`Reading API key for ${sourceName} from clipboard...`);
          apiKey = await readSecretFromClipboard();
        } else {
          console.log(`Enter API key for ${sourceName}:`);
          apiKey = await readSecretHidden();
        }
      } catch (err) {
        if (opts.json) {
          output({ success: false, error: 'Failed to read API key' });
        } else {
          outputError('Failed to read API key');
        }
        process.exit(1);
      }

      if (!apiKey || apiKey.trim().length === 0) {
        if (opts.json) {
          output({ success: false, error: 'API key cannot be empty' });
        } else {
          outputError('API key cannot be empty');
        }
        process.exit(1);
      }

      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        // Store the secret
        const store = new SqliteSecretStore(configDir);
        let secretRef: string;
        try {
          const result = await store.store(apiKey, {
            keyName: source.secretKey,
            source: `catalog.${sourceName}`,
          });
          secretRef = result.reference;
        } finally {
          store.close();
        }

        // Update config with secret reference
        const manager = new ConfigManager(configPath);
        const config = await manager.loadOrDefault();

        config.catalog = config.catalog || {};
        config.catalog.secrets = config.catalog.secrets || {};
        config.catalog.secrets[source.secretKey!] = secretRef;

        await manager.save(config);

        if (opts.json) {
          output({ success: true, source: sourceName, secretKey: source.secretKey });
        } else {
          outputSuccess(`API key for ${sourceName} stored successfully`);
          console.log(`Secret key: ${source.secretKey}`);
        }
      } catch (error) {
        if (opts.json) {
          output({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        } else {
          outputError(
            'Failed to store API key',
            error instanceof Error ? error : undefined
          );
        }
        process.exit(1);
      }
    });

  return cmd;
}
