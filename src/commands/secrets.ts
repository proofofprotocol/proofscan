/**
 * Secrets management command (Phase 3.6)
 *
 * Provides commands for managing secrets:
 * - list: Show all secrets with their bindings
 * - set: Store a secret for a connector/key
 * - edit: Interactive wizard to fill missing placeholders
 * - prune: Remove orphan secrets not referenced by config
 * - export: Export secrets to encrypted bundle
 * - import: Import secrets from encrypted bundle
 *
 * Security: Never print plaintext secrets to console, logs, or files.
 */

import { Command } from 'commander';
import { output, outputError, getOutputOptions } from '../utils/output.js';
import { getDefaultConfigDir, resolveConfigPath } from '../utils/config-path.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import type { Config, Connector } from '../types/index.js';
import {
  SqliteSecretStore,
  listSecretBindings,
  setSecret,
  pruneOrphanSecrets,
  exportSecrets,
  importSecrets,
  type SecretBindingInfo,
  type PruneResult,
  type ExportOptions,
  type ImportOptions,
} from '../secrets/index.js';
import { detectSecret } from '../secrets/detection.js';
import { readSecretHidden, readSecretFromClipboard } from '../utils/secret-input.js';

/**
 * Create the secrets command group
 */
export function createSecretsCommand(getConfigPath: () => string): Command {
  const secrets = new Command('secrets')
    .description('Secret management (list, set, edit, prune, export, import)');

  // ============================================================
  // secrets list
  // ============================================================
  secrets
    .command('list')
    .description('List all stored secrets with bindings')
    .option('--json', 'Output in JSON format')
    .option('--orphans', 'Show only orphan secrets (not bound to any config)')
    .action(async (options) => {
      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        const bindings = await listSecretBindings(configDir, configPath);

        if (options.orphans) {
          const orphans = bindings.filter(b => b.status === 'ORPHAN');
          if (getOutputOptions().json || options.json) {
            output(orphans);
          } else {
            if (orphans.length === 0) {
              output('No orphan secrets found.');
            } else {
              output(`Found ${orphans.length} orphan secret(s):\n`);
              for (const b of orphans) {
                output(`  ${b.secret_ref} (created: ${b.created_at})`);
              }
            }
          }
          return;
        }

        if (getOutputOptions().json || options.json) {
          output(bindings);
        } else {
          if (bindings.length === 0) {
            output('No secrets stored.');
            output('\nTo add secrets, use:');
            output('  pfscan secrets set <connector> <ENV_KEY>');
            return;
          }

          output(`Found ${bindings.length} secret(s):\n`);
          output('  CONNECTOR          ENV_KEY                    STATUS    PROVIDER  CREATED');
          output('  ─────────────────  ─────────────────────────  ────────  ────────  ───────────────────');
          for (const b of bindings) {
            const connector = (b.connector_id || '-').padEnd(17);
            const key = (b.env_key || '-').padEnd(25);
            const status = b.status.padEnd(8);
            const provider = b.provider.padEnd(8);
            const created = b.created_at.slice(0, 19);
            output(`  ${connector}  ${key}  ${status}  ${provider}  ${created}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to list secrets: ${msg}`);
        process.exit(1);
      }
    });

  // ============================================================
  // secrets set
  // ============================================================
  secrets
    .command('set <connector> <envKey>')
    .description('Set a secret value for a connector environment variable')
    .option('--clip', 'Read secret from clipboard instead of prompting')
    .action(async (connectorId: string, envKey: string, options) => {
      try {
        const configPath = getConfigPath();

        // Validate connector exists
        if (!existsSync(configPath)) {
          outputError(`Config file not found: ${configPath}`);
          process.exit(1);
        }

        let config: Config;
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch (parseErr) {
          outputError(`Invalid config file format: ${parseErr instanceof SyntaxError ? 'JSON parse error' : 'Read error'}`);
          process.exit(1);
        }
        const connector = config.connectors?.find(c => c.id === connectorId);

        if (!connector) {
          outputError(`Connector not found: ${connectorId}`);
          outputError(`Available connectors: ${config.connectors?.map(c => c.id).join(', ') || 'none'}`);
          process.exit(1);
        }

        // Read secret value
        let secretValue: string;
        if (options.clip) {
          output(`Reading secret for ${connectorId}.${envKey} from clipboard...`);
          secretValue = await readSecretFromClipboard();
        } else {
          output(`Enter secret for ${connectorId}.${envKey}:`);
          secretValue = await readSecretHidden();
        }

        if (!secretValue || secretValue.trim().length === 0) {
          outputError('Secret value cannot be empty');
          process.exit(1);
        }

        // Store secret and update config
        const result = await setSecret({
          configPath,
          connectorId,
          envKey,
          secretValue: secretValue.trim(),
        });

        output(`\n  Secret stored: ${result.secretRef}`);
        output(`  Config updated: ${connectorId}.transport.env.${envKey}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to set secret: ${msg}`);
        process.exit(1);
      }
    });

  // ============================================================
  // secrets edit
  // ============================================================
  secrets
    .command('edit [connector]')
    .description('Interactive wizard to fill missing/placeholder secrets')
    .option('--clip', 'Read secrets from clipboard')
    .action(async (connectorId: string | undefined, options) => {
      try {
        const configPath = getConfigPath();

        if (!existsSync(configPath)) {
          outputError(`Config file not found: ${configPath}`);
          process.exit(1);
        }

        let config: Config;
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8'));
        } catch (parseErr) {
          outputError(`Invalid config file format: ${parseErr instanceof SyntaxError ? 'JSON parse error' : 'Read error'}`);
          process.exit(1);
        }
        const connectors = connectorId
          ? config.connectors?.filter(c => c.id === connectorId)
          : config.connectors;

        if (!connectors || connectors.length === 0) {
          if (connectorId) {
            outputError(`Connector not found: ${connectorId}`);
          } else {
            outputError('No connectors configured');
          }
          process.exit(1);
        }

        // Find all missing/placeholder secrets
        const missing: { connector: Connector; key: string; value: string; reason: string }[] = [];

        for (const conn of connectors) {
          // Only stdio transport has env
          if (conn.transport?.type !== 'stdio') continue;
          const env = (conn.transport as import('../types/index.js').StdioTransport).env;
          if (!env) continue;

          for (const [key, value] of Object.entries(env)) {
            const detection = detectSecret(key, value as string);
            if (detection.action === 'warn') {
              // Placeholder detected
              missing.push({
                connector: conn,
                key,
                value: value as string,
                reason: 'placeholder',
              });
            } else if (detection.action === 'store' && !(value as string).match(/^(dpapi|keychain|plain):[a-zA-Z0-9_-]+$/)) {
              // Secret key but not yet stored (raw value)
              missing.push({
                connector: conn,
                key,
                value: value as string,
                reason: 'raw-secret',
              });
            }
          }
        }

        if (missing.length === 0) {
          output('All secrets are properly configured.');
          return;
        }

        output(`Found ${missing.length} secret(s) to configure:\n`);

        let updated = 0;
        for (let i = 0; i < missing.length; i++) {
          const item = missing[i];
          const label = `[${i + 1}/${missing.length}]`;
          output(`${label} ${item.connector.id}.${item.key}`);
          output(`      Current: ${item.reason === 'placeholder' ? '(placeholder)' : '(not stored)'}`);

          let secretValue: string;
          if (options.clip) {
            output('      Reading from clipboard...');
            secretValue = await readSecretFromClipboard();
          } else {
            output('      Enter value (or press Enter to skip):');
            secretValue = await readSecretHidden();
          }

          if (!secretValue || secretValue.trim().length === 0) {
            output('      Skipped.\n');
            continue;
          }

          await setSecret({
            configPath,
            connectorId: item.connector.id,
            envKey: item.key,
            secretValue: secretValue.trim(),
          });

          output('      Stored.\n');
          updated++;
        }

        output(`\nUpdated ${updated} of ${missing.length} secret(s).`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to edit secrets: ${msg}`);
        process.exit(1);
      }
    });

  // ============================================================
  // secrets prune
  // ============================================================
  secrets
    .command('prune')
    .description('Remove orphan secrets not referenced by config')
    .option('--dry-run', 'Show what would be removed without actually removing')
    .option('--older-than <days>', 'Only prune secrets older than N days', parseInt)
    .action(async (options) => {
      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        // Validate olderThan option
        const olderThanDays = options.olderThan;
        if (olderThanDays !== undefined && (isNaN(olderThanDays) || olderThanDays < 0)) {
          outputError('--older-than must be a positive number');
          process.exit(1);
        }

        const result = await pruneOrphanSecrets({
          configDir,
          configPath,
          dryRun: options.dryRun,
          olderThanDays,
        });

        if (getOutputOptions().json) {
          output(result);
        } else {
          if (result.orphanCount === 0) {
            output('No orphan secrets found.');
          } else if (options.dryRun) {
            output(`Would remove ${result.orphanCount} orphan secret(s):`);
            for (const id of result.removedIds) {
              output(`  - ${id}`);
            }
          } else {
            output(`Removed ${result.removedCount} orphan secret(s).`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to prune secrets: ${msg}`);
        process.exit(1);
      }
    });

  // ============================================================
  // secrets export
  // ============================================================
  secrets
    .command('export')
    .description('Export secrets to encrypted bundle file')
    .requiredOption('-o, --output <file>', 'Output file path')
    .option('--format <format>', 'Output format (json)', 'json')
    .action(async (options) => {
      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        output('Enter passphrase to encrypt the export:');
        const passphrase = await readSecretHidden();

        if (!passphrase || passphrase.length < 12) {
          outputError('Passphrase must be at least 12 characters');
          process.exit(1);
        }

        output('Confirm passphrase:');
        const confirm = await readSecretHidden();

        if (passphrase !== confirm) {
          outputError('Passphrases do not match');
          process.exit(1);
        }

        output('\nExporting secrets...');
        const result = await exportSecrets({
          configDir,
          configPath,
          outputPath: options.output,
          passphrase,
        });

        output(`\nExported ${result.exportedCount} secret(s) to: ${options.output}`);
        output('\nIMPORTANT: Store this file securely. It contains encrypted secrets.');
        output('           You will need the passphrase to import on another machine.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to export secrets: ${msg}`);
        process.exit(1);
      }
    });

  // ============================================================
  // secrets import
  // ============================================================
  secrets
    .command('import <file>')
    .description('Import secrets from encrypted bundle file')
    .option('--overwrite', 'Overwrite existing secrets with same connector/key')
    .option('--skip', 'Skip existing secrets (default)')
    .action(async (file: string, options) => {
      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        if (!existsSync(file)) {
          outputError(`File not found: ${file}`);
          process.exit(1);
        }

        output('Enter passphrase to decrypt the import:');
        const passphrase = await readSecretHidden();

        if (!passphrase) {
          outputError('Passphrase is required');
          process.exit(1);
        }

        output('\nImporting secrets...');
        const result = await importSecrets({
          configDir,
          configPath,
          inputPath: file,
          passphrase,
          overwrite: options.overwrite ?? false,
        });

        output(`\nImported ${result.importedCount} secret(s).`);
        if (result.skippedCount > 0) {
          output(`Skipped ${result.skippedCount} existing secret(s).`);
        }
        if (result.errorCount > 0) {
          output(`Failed to import ${result.errorCount} secret(s).`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to import secrets: ${msg}`);
        process.exit(1);
      }
    });

  return secrets;
}
