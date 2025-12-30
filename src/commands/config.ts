/**
 * Config commands
 */

import { Command } from 'commander';
import { createInterface } from 'readline';
import { readFile } from 'fs/promises';
import { ConfigManager } from '../config/index.js';
import { readClipboard } from '../utils/clipboard.js';
import {
  parseConnectorJson,
  toConnector,
  findDuplicates,
  findInternalDuplicates,
  type ParsedConnector,
  type AddResult,
} from '../config/add.js';
import {
  SnapshotManager,
  formatSnapshotLine,
  formatConfigDiff,
} from '../config/snapshot.js';
import { output, outputSuccess, outputError, maskSecretsInObject, getOutputOptions } from '../utils/output.js';

export function createConfigCommand(getConfigPath: () => string): Command {
  const cmd = new Command('config')
    .description('Manage proofscan configuration');

  cmd
    .command('path')
    .description('Show the config file path')
    .action(() => {
      const configPath = getConfigPath();
      output({ path: configPath }, configPath);
    });

  cmd
    .command('init')
    .description('Initialize a new config file')
    .option('-f, --force', 'Overwrite existing config')
    .option('-p, --path <path>', 'Custom config path')
    .action(async (options) => {
      try {
        const configPath = options.path || getConfigPath();
        const manager = new ConfigManager(configPath);
        const result = await manager.init(options.force);

        if (result.created) {
          outputSuccess(`Config created at: ${result.path}`);
        } else {
          output(
            { exists: true, path: result.path },
            `Config already exists at: ${result.path}\nUse --force to overwrite.`
          );
        }
      } catch (error) {
        outputError('Failed to initialize config', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('show')
    .description('Show current config or a snapshot (secrets masked)')
    .argument('[number]', 'Snapshot number to show (from ls)')
    .action(async (num?: string) => {
      try {
        const manager = new ConfigManager(getConfigPath());

        if (num) {
          // Show snapshot
          const snapshots = new SnapshotManager(manager.getConfigDir());
          const snapshot = await snapshots.getByNumber(parseInt(num, 10));

          if (!snapshot) {
            outputError(`Snapshot #${num} not found`);
            process.exit(1);
          }

          const masked = maskSecretsInObject(snapshot.config);

          if (getOutputOptions().json) {
            output({ snapshot: snapshot.meta, config: masked });
          } else {
            console.log(`Snapshot #${num}: ${snapshot.meta.note || '(no note)'}`);
            console.log(`Created: ${snapshot.meta.created_at}`);
            console.log();
            console.log(JSON.stringify(masked, null, 2));
          }
        } else {
          // Show current config
          const config = await manager.load();
          const masked = maskSecretsInObject(config);

          if (getOutputOptions().json) {
            output(masked);
          } else {
            console.log(JSON.stringify(masked, null, 2));
          }
        }
      } catch (error) {
        outputError('Failed to load config', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('validate')
    .description('Validate the config file')
    .action(async () => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const result = await manager.validate();

        if (result.valid) {
          outputSuccess('Config is valid');
        } else {
          output(
            { valid: false, errors: result.errors },
            `Config validation failed:\n${result.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n')}`
          );
          process.exit(1);
        }
      } catch (error) {
        outputError('Failed to validate config', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ============================================================
  // config add - add connectors from JSON
  // ============================================================
  cmd
    .command('add')
    .description('Add connectors from MCP server JSON (Claude Desktop, mcp.so, or array)')
    .addHelpText('after', `
Supported JSON formats:
  Claude Desktop:  { "mcpServers": { "<id>": { "command": "...", ... } } }
  Single object:   { "id": "...", "command": "...", "args": [...], "env": {...} }
  Array:           [ { "id": "...", "command": "...", ... }, ... ]

Examples:
  pfscan config add --clip             # Read from clipboard
  pfscan config add --clip --dry-run   # Preview clipboard content
  pfscan config add --file mcp.json    # Read from file
  pfscan config add                    # Paste JSON interactively
  cat mcp.json | pfscan config add     # Pipe from stdin
`)
    .option('--clip', 'Read JSON from system clipboard')
    .option('--file <path>', 'Read JSON from file')
    .option('--overwrite', 'Overwrite existing connector IDs')
    .option('--dry-run', 'Parse and show what would be added, without writing')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());

        // Read input: --clip > --file > stdin/interactive
        let jsonInput: string;
        if (options.clip) {
          try {
            jsonInput = readClipboard();
            if (!jsonInput || jsonInput.trim().length === 0) {
              outputError('Clipboard is empty\nHint: Use --file <path> or pipe JSON via stdin.');
              process.exit(1);
            }
          } catch (error) {
            outputError(
              'Failed to read clipboard',
              error instanceof Error ? error : undefined
            );
            process.exit(1);
          }
        } else if (options.file) {
          try {
            jsonInput = await readFile(options.file, 'utf-8');
          } catch (error) {
            outputError(
              `Failed to read file: ${options.file}`,
              error instanceof Error ? error : undefined
            );
            process.exit(1);
          }
        } else {
          jsonInput = await readStdinJson();
        }

        // Parse JSON
        const parseResult = parseConnectorJson(jsonInput);

        if (!parseResult.success || parseResult.connectors.length === 0) {
          if (parseResult.errors.length > 0) {
            outputError('Failed to parse JSON', new Error(parseResult.errors.join('\n')));
          } else {
            outputError('No connectors found in JSON');
          }
          process.exit(1);
        }

        // Check for internal duplicates
        const internalDups = findInternalDuplicates(parseResult.connectors);
        if (internalDups.length > 0) {
          outputError(`Duplicate IDs in input: ${internalDups.join(', ')}`);
          process.exit(1);
        }

        // Load existing config
        const config = await manager.loadOrDefault();

        // Check for duplicates with existing connectors
        const duplicates = findDuplicates(parseResult.connectors, config.connectors);

        // Handle duplicates
        if (duplicates.length > 0 && !options.overwrite && !options.dryRun) {
          outputError(
            `Connector IDs already exist: ${duplicates.join(', ')}\n` +
            'Use --overwrite to update them, or --dry-run to preview.'
          );
          process.exit(1);
        }

        // Prepare result
        const result: AddResult = {
          added: [],
          updated: [],
          skipped: [],
          duplicates,
          secret_refs_sanitized: 0,
        };

        // Process connectors
        const existingIds = new Set(config.connectors.map(c => c.id));

        for (const parsed of parseResult.connectors) {
          const { connector, secretRefCount } = toConnector(parsed);

          if (existingIds.has(parsed.id)) {
            if (options.overwrite) {
              // Update existing
              const index = config.connectors.findIndex(c => c.id === parsed.id);
              config.connectors[index] = connector;
              result.updated.push(parsed.id);
              result.secret_refs_sanitized += secretRefCount;
            } else {
              // Skipped: do NOT count secret refs (not actually saved)
              result.skipped.push(parsed.id);
            }
          } else {
            // Add new
            config.connectors.push(connector);
            result.added.push(parsed.id);
            result.secret_refs_sanitized += secretRefCount;
          }
        }

        // Output summary
        const summary = formatAddSummary(parseResult.connectors, result, options.dryRun);

        if (getOutputOptions().json) {
          output({
            dry_run: options.dryRun || false,
            parsed_count: parseResult.connectors.length,
            added: result.added,
            updated: result.updated,
            skipped: result.skipped,
            secret_refs_sanitized: result.secret_refs_sanitized,
          });
        } else {
          console.log(summary);
        }

        // Save if not dry-run
        if (!options.dryRun && (result.added.length > 0 || result.updated.length > 0)) {
          await manager.save(config);
          outputSuccess('Config updated');
        } else if (options.dryRun) {
          console.log('\n(dry-run: no changes written)');
        }

      } catch (error) {
        outputError('Failed to add connectors', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ============================================================
  // config save - save snapshot
  // ============================================================
  cmd
    .command('save')
    .description('Save a snapshot of the current config')
    .option('--note <text>', 'Add a note to the snapshot')
    .action(async (options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const config = await manager.load();
        const snapshots = new SnapshotManager(manager.getConfigDir());

        const meta = await snapshots.save(config, options.note);

        if (getOutputOptions().json) {
          output(meta);
        } else {
          outputSuccess(`Snapshot saved: ${meta.id}`);
          if (meta.note) {
            console.log(`  Note: "${meta.note}"`);
          }
          console.log(`  Connectors: ${meta.connector_count}`);
        }
      } catch (error) {
        outputError('Failed to save snapshot', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ============================================================
  // config ls - list snapshots
  // ============================================================
  cmd
    .command('ls')
    .description('List saved config snapshots')
    .action(async () => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const snapshots = new SnapshotManager(manager.getConfigDir());

        const list = await snapshots.list();

        if (list.length === 0) {
          console.log('No snapshots saved.');
          console.log('Use `pfscan config save` to create one.');
          return;
        }

        // Find which snapshot matches current config
        let currentMatch: number | null = null;
        try {
          const config = await manager.load();
          currentMatch = await snapshots.findMatchingSnapshot(config);
        } catch {
          // Config might not exist
        }

        if (getOutputOptions().json) {
          output({
            snapshots: list,
            current_match: currentMatch,
          });
        } else {
          console.log('Snapshots (newest first):');
          console.log();
          for (let i = 0; i < list.length; i++) {
            const isCurrent = currentMatch === i + 1;
            console.log(formatSnapshotLine(i + 1, list[i], isCurrent));
          }
        }
      } catch (error) {
        outputError('Failed to list snapshots', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ============================================================
  // config load - load snapshot
  // ============================================================
  cmd
    .command('load')
    .description('Load a saved snapshot (dry-run by default)')
    .argument('<number>', 'Snapshot number to load (from ls)')
    .option('--force', 'Actually replace current config')
    .action(async (num: string, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const snapshots = new SnapshotManager(manager.getConfigDir());

        const snapshotNum = parseInt(num, 10);
        const snapshot = await snapshots.getByNumber(snapshotNum);

        if (!snapshot) {
          outputError(`Snapshot #${num} not found`);
          process.exit(1);
        }

        // Load current config for diff
        let currentConfig;
        try {
          currentConfig = await manager.load();
        } catch {
          currentConfig = { version: 1 as const, connectors: [] };
        }

        const diff = snapshots.diffConfigs(currentConfig, snapshot.config);

        if (getOutputOptions().json) {
          output({
            dry_run: !options.force,
            snapshot: snapshot.meta,
            diff,
          });
        } else {
          console.log(`Snapshot #${num}: ${snapshot.meta.note || '(no note)'}`);
          console.log(`Created: ${snapshot.meta.created_at}`);
          console.log();
          console.log('Changes:');
          console.log(formatConfigDiff(diff));
        }

        if (options.force) {
          await manager.save(snapshot.config);
          outputSuccess('Config replaced with snapshot');
        } else {
          console.log();
          console.log('(dry-run: use --force to apply)');
        }
      } catch (error) {
        outputError('Failed to load snapshot', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ============================================================
  // config delete - delete snapshot
  // ============================================================
  cmd
    .command('delete')
    .description('Delete a saved snapshot (dry-run by default)')
    .argument('<number>', 'Snapshot number to delete (from ls)')
    .option('--force', 'Actually delete the snapshot')
    .action(async (num: string, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const snapshots = new SnapshotManager(manager.getConfigDir());

        const snapshotNum = parseInt(num, 10);
        const snapshot = await snapshots.getByNumber(snapshotNum);

        if (!snapshot) {
          outputError(`Snapshot #${num} not found`);
          process.exit(1);
        }

        if (getOutputOptions().json) {
          output({
            dry_run: !options.force,
            snapshot: snapshot.meta,
          });
        } else {
          console.log(`Snapshot #${num}: ${snapshot.meta.note || '(no note)'}`);
          console.log(`Created: ${snapshot.meta.created_at}`);
          console.log(`Connectors: ${snapshot.meta.connector_count}`);
        }

        if (options.force) {
          await snapshots.delete(snapshotNum);
          outputSuccess('Snapshot deleted');
        } else {
          console.log();
          console.log('(dry-run: use --force to delete)');
        }
      } catch (error) {
        outputError('Failed to delete snapshot', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Read JSON from stdin interactively
 */
async function readStdinJson(): Promise<string> {
  // Check if stdin is a TTY (interactive)
  if (process.stdin.isTTY) {
    console.log('Paste MCP server configuration (JSON), then press Ctrl+D:');
  }

  return new Promise((resolve, reject) => {
    const chunks: string[] = [];

    const rl = createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on('line', (line) => {
      chunks.push(line);
    });

    rl.on('close', () => {
      const content = chunks.join('\n').trim();
      if (content.length === 0) {
        reject(new Error('No input received'));
      } else {
        resolve(content);
      }
    });

    rl.on('error', reject);
  });
}

/**
 * Format summary for add operation
 */
function formatAddSummary(
  parsed: ParsedConnector[],
  result: AddResult,
  dryRun: boolean
): string {
  const lines: string[] = [];
  const action = dryRun ? 'Would' : 'Will';

  lines.push(`Parsed ${parsed.length} connector(s)`);
  lines.push('');

  // Show connector list with masked env
  for (const p of parsed) {
    const envInfo = p.env ? ` (${Object.keys(p.env).length} env vars)` : '';
    const argsInfo = p.args ? ` [${p.args.length} args]` : '';
    lines.push(`  ${p.id}: ${p.command}${argsInfo}${envInfo}`);
  }

  lines.push('');

  if (result.added.length > 0) {
    lines.push(`${action} add: ${result.added.join(', ')}`);
  }

  if (result.updated.length > 0) {
    lines.push(`${action} update: ${result.updated.join(', ')}`);
  }

  if (result.skipped.length > 0) {
    lines.push(`Skipped (already exists): ${result.skipped.join(', ')}`);
  }

  // Phase 3.4: Show secret sanitization info
  if (result.secret_refs_sanitized > 0) {
    lines.push('');
    lines.push(`Secret refs sanitized: ${result.secret_refs_sanitized} (stored as "secret://***")`);
  }

  return lines.join('\n');
}
