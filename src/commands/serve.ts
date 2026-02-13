/**
 * Serve command - start the Protocol Gateway HTTP server
 * Phase 8.1: HTTP server foundation
 * Phase 8.2: Bearer Token Authentication
 */

import { Command } from 'commander';
import { createGatewayServer } from '../gateway/server.js';
import { createLogger } from '../gateway/logger.js';
import { AuthConfig, TokenConfig } from '../gateway/auth.js';

export function createServeCommand(): Command {
  const cmd = new Command('serve')
    .description('Start the Protocol Gateway HTTP server')
    .option('-p, --port <port>', 'Server port', '3000')
    .option('-h, --host <host>', 'Server host', '127.0.0.1')
    .option('--auth-mode <mode>', 'Authentication mode (none, bearer)', 'none')
    .option('--token-hash <hash>', 'Token hash in sha256:xxx format (can be specified multiple times)', collectTokenHashes, [])
    .action(async (options) => {
      const port = parseInt(options.port, 10);
      const host = options.host as string;
      const authMode = options.authMode as 'none' | 'bearer';
      const tokenHashes = options.tokenHash as string[];

      if (isNaN(port) || port < 0 || port > 65535) {
        console.error(`Error: Invalid port number: ${options.port}`);
        process.exit(1);
      }

      // Validate auth mode
      if (!['none', 'bearer'].includes(authMode)) {
        console.error(`Error: Invalid auth mode: ${authMode}. Must be 'none' or 'bearer'.`);
        process.exit(1);
      }

      // Build auth config
      const auth = buildAuthConfig(authMode, tokenHashes);

      // Warn if bearer mode but no tokens
      if (auth.mode === 'bearer' && auth.tokens.length === 0) {
        console.error('Error: Bearer auth mode requires at least one --token-hash');
        process.exit(1);
      }

      const logger = createLogger();

      const gateway = createGatewayServer({ port, host, auth }, logger);

      try {
        const address = await gateway.start();
        console.log(`Protocol Gateway listening at ${address}`);
        console.log('Press Ctrl+C to stop');

        // Keep process running until server handles shutdown
        // Signal handlers in server.ts will handle graceful shutdown and process.exit()
        await new Promise<void>(() => {
          // Never resolves - server.ts signal handler will call process.exit()
        });
      } catch (error) {
        console.error('Failed to start server:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Collect multiple --token-hash values into an array
 */
function collectTokenHashes(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Build AuthConfig from CLI options
 */
function buildAuthConfig(mode: 'none' | 'bearer', tokenHashes: string[]): AuthConfig {
  if (mode === 'none') {
    return { mode: 'none', tokens: [] };
  }

  // Parse token hashes
  // Format: sha256:xxx or name:sha256:xxx (with optional name prefix)
  const tokens: TokenConfig[] = tokenHashes.map((hash, index) => {
    let name: string;
    let tokenHash: string;

    // Check if name is provided (name:sha256:xxx)
    const colonCount = (hash.match(/:/g) || []).length;
    if (colonCount >= 2) {
      // Has name prefix
      const firstColon = hash.indexOf(':');
      name = hash.slice(0, firstColon);
      tokenHash = hash.slice(firstColon + 1);
    } else {
      // No name, use default
      name = `token-${index + 1}`;
      tokenHash = hash;
    }

    // Validate hash format
    if (!tokenHash.startsWith('sha256:')) {
      console.error(`Error: Invalid token hash format: ${tokenHash}. Must start with 'sha256:'`);
      process.exit(1);
    }

    return {
      name,
      token_hash: tokenHash,
      permissions: ['*'], // Default: full access via CLI
    };
  });

  return { mode: 'bearer', tokens };
}
