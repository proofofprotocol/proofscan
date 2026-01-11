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
  // secrets ls (main) / list (alias)
  // ============================================================
  const listAction = async (options: { json?: boolean; orphans?: boolean }) => {
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
            output('  pfscan secrets set <namespace>  (e.g., catalog.smithery)');
            return;
          }

          output(`Found ${bindings.length} secret(s):\n`);
          output('  KIND       CONNECTOR/NAMESPACE   KEY                        STATUS    PROVIDER  CREATED');
          output('  ─────────  ────────────────────  ─────────────────────────  ────────  ────────  ───────────────────');
          for (const b of bindings) {
            const kind = b.kind.padEnd(9);
            let identifier: string;
            let key: string;
            if (b.kind === 'namespace') {
              // For namespace, show the namespace key in identifier column, key is '-'
              identifier = (b.env_key || '-').padEnd(20);
              key = '-'.padEnd(25);
            } else {
              // For connector, show connector_id and env_key
              identifier = (b.connector_id || '-').padEnd(20);
              key = (b.env_key || '-').padEnd(25);
            }
            const status = b.status.padEnd(8);
            const provider = b.provider.padEnd(8);
            const created = b.created_at.slice(0, 19);
            output(`  ${kind}  ${identifier}  ${key}  ${status}  ${provider}  ${created}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to list secrets: ${msg}`);
        process.exit(1);
      }
  };

  secrets
    .command('ls')
    .description('List all stored secrets with bindings')
    .option('--json', 'Output in JSON format')
    .option('--orphans', 'Show only orphan secrets (not bound to any config)')
    .action(listAction);

  secrets
    .command('list')
    .description('Alias for ls')
    .option('--json', 'Output in JSON format')
    .option('--orphans', 'Show only orphan secrets (not bound to any config)')
    .action(listAction);

  // ============================================================
  // secrets set
  // ============================================================
  // Supports two modes:
  // 1. Connector mode: pfscan secrets set <connector> <envKey>
  // 2. Namespace mode: pfscan secrets set <namespace>
  //    e.g., pfscan secrets set catalog.smithery
  secrets
    .command('set <namespaceOrConnector> [key]')
    .description('Set a secret value (connector env or namespace)\n\nExamples:\n  pfscan secrets set my-connector OPENAI_API_KEY\n  pfscan secrets set catalog.smithery')
    .option('--clip', 'Read secret from clipboard instead of prompting')
    .action(async (namespaceOrConnector: string, key: string | undefined, options) => {
      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        // Determine mode: namespace (contains dot) vs connector
        const isNamespaceMode = namespaceOrConnector.includes('.');

        if (isNamespaceMode) {
          // Namespace mode: e.g., "catalog.smithery"
          // key is ignored in namespace mode - the full namespace IS the key
          const fullKey = namespaceOrConnector;

          // Read secret value
          let secretValue: string;
          if (options.clip) {
            output(`Reading secret for ${fullKey} from clipboard...`);
            secretValue = await readSecretFromClipboard();
          } else {
            process.stdout.write(`Enter secret for ${fullKey}: `);
            secretValue = await readSecretHidden();
          }

          if (!secretValue || secretValue.trim().length === 0) {
            outputError('Secret value cannot be empty');
            process.exit(1);
          }

          // Store the secret
          const store = new SqliteSecretStore(configDir);
          let secretRef: string;
          try {
            const result = await store.store(secretValue.trim(), {
              keyName: fullKey,
              source: fullKey,
            });
            secretRef = result.reference;
          } finally {
            store.close();
          }

          // Update config with secret reference
          const { ConfigManager } = await import('../config/index.js');
          const manager = new ConfigManager(configPath);
          const config = await manager.loadOrDefault();

          // Parse namespace path (e.g., "catalog.smithery" -> config.catalog.secrets["catalog.smithery"])
          const parts = fullKey.split('.');
          if (parts[0] === 'catalog') {
            config.catalog = config.catalog || {};
            config.catalog.secrets = config.catalog.secrets || {};
            config.catalog.secrets[fullKey] = secretRef;
          } else {
            // Generic namespace support for future use
            // Store in config under the namespace path
            outputError(`Unknown namespace: ${parts[0]}. Supported: catalog`);
            process.exit(1);
          }

          await manager.save(config);

          output(`\n  Secret stored: ${secretRef}`);
          output(`  Config updated: ${fullKey}`);
        } else {
          // Connector mode (existing behavior)
          const connectorId = namespaceOrConnector;
          const envKey = key;

          // key is required in connector mode
          if (!envKey) {
            outputError('Usage: pfscan secrets set <connector> <envKey>');
            outputError('       pfscan secrets set <namespace>  (e.g., catalog.smithery)');
            process.exit(1);
          }

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
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to set secret: ${msg}`);
        process.exit(1);
      }
    });

  // ============================================================
  // secrets get (new command for namespace secrets)
  // ============================================================
  secrets
    .command('get <namespace>')
    .description('Check if a namespace secret exists (does not show value)\n\nExamples:\n  pfscan secrets get catalog.smithery')
    .action(async (namespace: string) => {
      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        if (!namespace.includes('.')) {
          outputError('Argument must be a namespace (e.g., catalog.smithery)');
          outputError('For connector secrets, use: pfscan secrets list');
          process.exit(1);
        }

        const fullKey = namespace;
        const parts = namespace.split('.');

        // Read config
        const { ConfigManager } = await import('../config/index.js');
        const manager = new ConfigManager(configPath);
        const config = await manager.loadOrDefault();

        let secretRef: string | undefined;
        if (parts[0] === 'catalog') {
          secretRef = config.catalog?.secrets?.[fullKey];
        } else {
          outputError(`Unknown namespace: ${parts[0]}. Supported: catalog`);
          process.exit(1);
        }

        if (!secretRef) {
          if (getOutputOptions().json) {
            output({ exists: false, key: fullKey });
          } else {
            output(`Secret not found: ${fullKey}`);
            output(`\nTo set it: pfscan secrets set ${fullKey}`);
          }
          process.exit(1);
        }

        // Verify secret exists in store
        const store = new SqliteSecretStore(configDir);
        try {
          const match = secretRef.match(/^[^:]+:(.+)$/);
          if (!match) {
            if (getOutputOptions().json) {
              output({ exists: false, key: fullKey, error: 'Invalid reference' });
            } else {
              outputError(`Invalid secret reference: ${secretRef}`);
            }
            process.exit(1);
          }
          const secretId = match[1];
          const exists = await store.exists(secretId);

          if (getOutputOptions().json) {
            output({ exists, key: fullKey, reference: secretRef });
          } else {
            if (exists) {
              output(`Secret exists: ${fullKey}`);
              output(`  Reference: ${secretRef}`);
            } else {
              output(`Secret reference found but value missing: ${fullKey}`);
              output(`  Stored reference: ${secretRef}`);
              output(`\nRe-set it: pfscan secrets set ${fullKey}`);
            }
          }
        } finally {
          store.close();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to get secret: ${msg}`);
        process.exit(1);
      }
    });

  // ============================================================
  // secrets unset (new command for namespace secrets)
  // ============================================================
  secrets
    .command('unset <namespace>')
    .description('Remove a namespace secret\n\nExamples:\n  pfscan secrets unset catalog.smithery')
    .action(async (namespace: string) => {
      try {
        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        if (!namespace.includes('.')) {
          outputError('Argument must be a namespace (e.g., catalog.smithery)');
          outputError('For connector secrets, use: pfscan secrets prune');
          process.exit(1);
        }

        const fullKey = namespace;
        const parts = namespace.split('.');

        // Read config
        const { ConfigManager } = await import('../config/index.js');
        const manager = new ConfigManager(configPath);
        const config = await manager.loadOrDefault();

        let secretRef: string | undefined;
        if (parts[0] === 'catalog') {
          secretRef = config.catalog?.secrets?.[fullKey];
          if (secretRef && config.catalog?.secrets) {
            delete config.catalog.secrets[fullKey];
          }
        } else {
          outputError(`Unknown namespace: ${parts[0]}. Supported: catalog`);
          process.exit(1);
        }

        if (!secretRef) {
          if (getOutputOptions().json) {
            output({ removed: false, key: fullKey, reason: 'not found' });
          } else {
            output(`Secret not found: ${fullKey}`);
          }
          return;
        }

        // Remove from store
        const store = new SqliteSecretStore(configDir);
        try {
          const match = secretRef.match(/^[^:]+:(.+)$/);
          if (match) {
            const secretId = match[1];
            await store.delete(secretId);
          }
        } finally {
          store.close();
        }

        // Save updated config
        await manager.save(config);

        if (getOutputOptions().json) {
          output({ removed: true, key: fullKey });
        } else {
          output(`Secret removed: ${fullKey}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputError(`Failed to unset secret: ${msg}`);
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
    .option('-o, --output <file>', 'Output file path (required)')
    .option('--format <format>', 'Output format (json)', 'json')
    .action(async (options) => {
      try {
        // Validate required -o option with friendly hint
        if (!options.output) {
          outputError('Required: -o, --output <file>');
          output('Example: pfscan secrets export -o proofscan-secrets.export.json');
          process.exit(1);
        }

        const configPath = getConfigPath();
        const configDir = dirname(configPath);

        output('Enter passphrase to encrypt the export (min 12 chars):');
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
