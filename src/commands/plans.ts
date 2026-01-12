/**
 * Plans commands - validation plan management
 * Phase 5.2: MCP validation scenario management
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import { resolve, dirname } from 'path';
import { PlansStore } from '../plans/store.js';
import { PlanRunner } from '../plans/runner.js';
import { DEFAULT_PLAN_NAME } from '../plans/builtin.js';
import { validatePlanDefinition, isValidPlanName } from '../plans/schema.js';
import { ConfigManager } from '../config/index.js';
import { EventLineStore } from '../eventline/store.js';
import { output, outputSuccess, outputError, outputTable } from '../utils/output.js';
import { setCurrentSession } from '../utils/state.js';
import { shortenSessionId } from '../shell/prompt.js';
import type { PlanDefinition } from '../plans/schema.js';

/**
 * Get config directory from config file path
 * PlansStore and PlanRunner expect a directory, not a file path
 */
function getConfigDir(configPath: string): string {
  return dirname(configPath);
}

/**
 * Maximum input size for plan YAML (10MB)
 */
const MAX_STDIN_SIZE = 10 * 1024 * 1024;

/**
 * Maximum timeout in seconds
 */
const MAX_TIMEOUT_SECONDS = 300;

/**
 * Minimum timeout in seconds
 */
const MIN_TIMEOUT_SECONDS = 1;

/**
 * Read from stdin with size limit
 */
async function readStdin(maxBytes = MAX_STDIN_SIZE): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of process.stdin) {
    totalSize += chunk.length;
    if (totalSize > maxBytes) {
      throw new Error(`Input exceeds maximum size of ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Validate and parse timeout value
 */
function parseTimeout(value: string): number {
  const timeout = parseInt(value, 10);
  if (isNaN(timeout) || timeout < MIN_TIMEOUT_SECONDS || timeout > MAX_TIMEOUT_SECONDS) {
    throw new Error(`Timeout must be between ${MIN_TIMEOUT_SECONDS} and ${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return timeout;
}

export function createPlansCommand(getConfigPath: () => string): Command {
  const cmd = new Command('plans')
    .description('Manage validation plans');

  // List plans action
  const listAction = async () => {
    try {
      const store = new PlansStore(getConfigDir(getConfigPath()));
      const plans = store.listPlans();

      if (plans.length === 0) {
        output({ plans: [] }, 'No plans found.');
        return;
      }

      const headers = ['Name', 'Source', 'Description', 'Created'];
      const rows = plans.map(p => [
        p.name,
        p.source,
        (p.description || '').slice(0, 40) + ((p.description?.length || 0) > 40 ? '...' : ''),
        p.created_at.slice(0, 10),
      ]);

      outputTable(headers, rows);
    } catch (error) {
      outputError('Failed to list plans', error instanceof Error ? error : undefined);
      process.exit(1);
    }
  };

  cmd
    .command('ls')
    .description('List all plans')
    .action(listAction);

  cmd
    .command('list')
    .description('Alias for ls')
    .action(listAction);

  cmd
    .command('show')
    .description('Show plan details')
    .argument('<name>', 'Plan name')
    .option('--raw', 'Show raw YAML content')
    .option('--json', 'Output as JSON')
    .action(async (name, options) => {
      try {
        const store = new PlansStore(getConfigDir(getConfigPath()));
        const plan = store.getPlan(name);

        if (!plan) {
          outputError(`Plan not found: ${name}`);
          process.exit(1);
        }

        if (options.raw) {
          console.log(plan.content_yaml);
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
          return;
        }

        // Human-readable output
        console.log(`Name: ${plan.name}`);
        console.log(`Digest: ${plan.digest_sha256}`);
        console.log(`Source: ${plan.source}`);
        if (plan.description) {
          console.log(`Description: ${plan.description}`);
        }
        if (plan.default_connector) {
          console.log(`Default connector: ${plan.default_connector}`);
        }
        console.log(`Created: ${plan.created_at}`);
        console.log(`Updated: ${plan.updated_at}`);
        console.log('');
        console.log('--- YAML ---');
        console.log(plan.content_yaml);
      } catch (error) {
        outputError('Failed to show plan', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('add')
    .description('Add a new plan')
    .argument('<name>', 'Plan name (lowercase, numbers, hyphens, underscores only)')
    .option('--file <path>', 'Read plan YAML from file')
    .option('--stdin', 'Read plan YAML from stdin')
    .action(async (name, options) => {
      try {
        if (!isValidPlanName(name)) {
          outputError('Invalid plan name. Use lowercase letters, numbers, hyphens, and underscores only.');
          process.exit(1);
        }

        if (!options.file && !options.stdin) {
          outputError('Either --file or --stdin is required');
          process.exit(1);
        }

        let yamlContent: string;
        if (options.stdin) {
          yamlContent = await readStdin();
        } else {
          yamlContent = await fs.readFile(options.file, 'utf-8');
        }

        // Parse and validate
        const yaml = await import('yaml');
        let def: PlanDefinition;
        try {
          def = yaml.parse(yamlContent) as PlanDefinition;
        } catch (e) {
          outputError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        }

        const validation = validatePlanDefinition(def);
        if (!validation.valid) {
          outputError(`Plan validation failed:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`);
          process.exit(1);
        }

        const store = new PlansStore(getConfigDir(getConfigPath()));
        const result = store.addPlan(name, yamlContent, 'manual');

        if (!result.success) {
          outputError(result.error || 'Failed to add plan');
          process.exit(1);
        }

        outputSuccess(`Plan '${name}' added (digest: ${result.plan!.digest_sha256.slice(0, 12)}...)`);
      } catch (error) {
        outputError('Failed to add plan', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('delete')
    .description('Delete a plan')
    .argument('<name>', 'Plan name')
    .option('--force', 'Delete without confirmation')
    .action(async (name, options) => {
      try {
        const store = new PlansStore(getConfigDir(getConfigPath()));
        const plan = store.getPlan(name);

        if (!plan) {
          outputError(`Plan not found: ${name}`);
          process.exit(1);
        }

        // Check for runs if not forcing
        if (!options.force) {
          const runs = store.listRuns(name, 1);
          if (runs.length > 0) {
            console.log(`Warning: Plan '${name}' has associated runs.`);
            console.log('Use --force to delete anyway (runs will keep reference by digest).');
            process.exit(1);
          }
        }

        const result = store.deletePlan(name, options.force);
        if (!result.success) {
          outputError(result.error || 'Failed to delete plan');
          process.exit(1);
        }
        outputSuccess(`Plan '${name}' deleted`);
      } catch (error) {
        outputError('Failed to delete plan', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('import')
    .description('Import plans from YAML file (supports multi-document)')
    .option('--file <path>', 'YAML file to import')
    .option('--stdin', 'Read from stdin')
    .action(async (options) => {
      try {
        if (!options.file && !options.stdin) {
          outputError('Either --file or --stdin is required');
          process.exit(1);
        }

        let yamlContent: string;
        if (options.stdin) {
          yamlContent = await readStdin();
        } else {
          yamlContent = await fs.readFile(options.file, 'utf-8');
        }

        const store = new PlansStore(getConfigDir(getConfigPath()));
        const result = store.importPlans(yamlContent, 'import');

        if (result.errors.length > 0) {
          console.error('Import errors:');
          for (const err of result.errors) {
            const prefix = err.name ? `${err.name}: ` : '';
            console.error(`  - ${prefix}${err.error}`);
          }
        }

        if (result.imported.length > 0) {
          outputSuccess(`Imported ${result.imported.length} plan(s): ${result.imported.join(', ')}`);
        } else {
          output({ imported: [] }, 'No plans imported.');
        }
      } catch (error) {
        outputError('Failed to import plans', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('export')
    .description('Export a plan to YAML file')
    .argument('<name>', 'Plan name')
    .option('--file <path>', 'Output file path')
    .option('--stdout', 'Output to stdout')
    .action(async (name, options) => {
      try {
        const store = new PlansStore(getConfigDir(getConfigPath()));
        const plan = store.getPlan(name);

        if (!plan) {
          outputError(`Plan not found: ${name}`);
          process.exit(1);
        }

        if (options.stdout || !options.file) {
          console.log(plan.content_yaml);
          return;
        }

        await fs.writeFile(options.file, plan.content_yaml, 'utf-8');
        outputSuccess(`Plan '${name}' exported to ${options.file}`);
      } catch (error) {
        outputError('Failed to export plan', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  cmd
    .command('run')
    .description(`Run a plan against a connector (default: ${DEFAULT_PLAN_NAME})`)
    .argument('[name]', 'Plan name', DEFAULT_PLAN_NAME)
    .requiredOption('--connector <id>', 'Connector ID')
    .option('--out <dir>', 'Custom output directory for artifacts')
    .option('--timeout <seconds>', 'Timeout per step in seconds (1-300)', '30')
    .option('--dry-run', 'Show steps without executing')
    .option('--json', 'Output result as JSON')
    .action(async (nameArg, options) => {
      try {
        // Use default plan if not specified
        const name = nameArg || DEFAULT_PLAN_NAME;

        // Validate timeout
        let timeout: number;
        try {
          timeout = parseTimeout(options.timeout);
        } catch (e) {
          outputError(e instanceof Error ? e.message : String(e));
          process.exit(1);
        }

        const store = new PlansStore(getConfigDir(getConfigPath()));
        const plan = store.getPlan(name);

        if (!plan) {
          outputError(`Plan not found: ${name}`);
          process.exit(1);
        }

        // Get connector
        const configManager = new ConfigManager(getConfigPath());
        const connector = await configManager.getConnector(options.connector);

        if (!connector) {
          // Check if connector exists in history (events.db) but not in config
          const eventStore = new EventLineStore(getConfigDir(getConfigPath()));
          const historyConnectors = eventStore.getConnectors();
          const existsInHistory = historyConnectors.some((c: { id: string }) => c.id === options.connector);

          if (existsInHistory) {
            outputError(`Connector '${options.connector}' exists in history but is not configured.`);
            console.error(`  Run 'pfscan connectors add' to add it, or use 'pfscan connectors ls' to see configured connectors.`);
          } else {
            outputError(`Connector not found: ${options.connector}`);
          }
          process.exit(1);
        }

        // Parse plan definition
        const yaml = await import('yaml');
        const def = yaml.parse(plan.content_yaml) as PlanDefinition;

        // Dry run mode
        if (options.dryRun) {
          console.log(`Plan: ${plan.name}`);
          console.log(`Connector: ${connector.id}`);
          console.log(`Steps (${def.steps.length}):`);
          for (let i = 0; i < def.steps.length; i++) {
            const step = def.steps[i];
            const condition = step.when ? ` (when: ${step.when})` : '';
            console.log(`  ${i + 1}. ${step.mcp}${condition}`);
          }
          return;
        }

        console.log(`Running plan '${name}' against connector '${connector.id}'...`);

        const runner = new PlanRunner(getConfigDir(getConfigPath()));
        const result = await runner.run(plan, connector, {
          timeout,
          outDir: options.out,
          dryRun: false,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Set current session for shell navigation
        if (result.sessionId) {
          setCurrentSession(result.sessionId, connector.id);
        }

        // Human-readable output
        console.log('');
        console.log(`Run ID: ${result.runId}`);
        if (result.sessionId) {
          console.log(`Session: ${shortenSessionId(result.sessionId)}`);
        }
        console.log(`Status: ${result.status}`);
        console.log(`Duration: ${new Date(result.endedAt).getTime() - new Date(result.startedAt).getTime()}ms`);
        console.log('');
        console.log('Steps:');
        for (const step of result.steps) {
          const status = step.skipped
            ? 'SKIP'
            : step.response?.error
              ? 'FAIL'
              : 'OK';
          const extra = step.skipped
            ? ` (${step.skipReason})`
            : step.response?.error
              ? ` (${(step.response.error as { message?: string }).message || 'error'})`
              : '';
          console.log(`  ${step.stepIndex + 1}. [${status}] ${step.method}${extra} (${step.durationMs}ms)`);
        }

        // Show inventory summary
        if (result.inventory.capabilities) {
          console.log('');
          console.log('Inventory:');
          const caps = result.inventory.capabilities as Record<string, unknown>;
          const capKeys = Object.keys(caps).filter(k => caps[k]);
          if (capKeys.length > 0) {
            console.log(`  Capabilities: ${capKeys.join(', ')}`);
          }
          if (result.inventory.tools) {
            console.log(`  Tools: ${(result.inventory.tools as unknown[]).length}`);
          }
          if (result.inventory.resources) {
            console.log(`  Resources: ${(result.inventory.resources as unknown[]).length}`);
          }
          if (result.inventory.prompts) {
            console.log(`  Prompts: ${(result.inventory.prompts as unknown[]).length}`);
          }
        }

        console.log('');
        const artifactPath = resolve(options.out || getConfigDir(getConfigPath()), 'artifacts', result.runId);
        console.log(`Artifacts: ${artifactPath}`);
        console.log('');
        if (result.sessionId) {
          console.log(`Tip: Use "cd ${shortenSessionId(result.sessionId)}" to navigate to the session, or "plans runs" to list all runs.`);
        } else {
          console.log('Tip: Use "plans runs" to list all runs.');
        }
      } catch (error) {
        outputError('Failed to run plan', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // List runs subcommand
  cmd
    .command('runs')
    .description('List plan runs')
    .option('--plan <name>', 'Filter by plan name')
    .option('--limit <n>', 'Limit results', '20')
    .action(async (options) => {
      try {
        const store = new PlansStore(getConfigDir(getConfigPath()));
        const runs = store.listRuns(options.plan, parseInt(options.limit, 10));

        if (runs.length === 0) {
          output({ runs: [] }, 'No runs found.');
          return;
        }

        const headers = ['Run ID', 'Plan', 'Connector', 'Status', 'Started'];
        const rows = runs.map(r => [
          r.run_id.slice(0, 12) + '...',
          r.plan_name || '(deleted)',
          r.connector_id,
          r.status,
          r.started_at.slice(0, 19),
        ]);

        outputTable(headers, rows);
      } catch (error) {
        outputError('Failed to list runs', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // Show run details
  cmd
    .command('run-show')
    .description('Show run details')
    .argument('<runId>', 'Run ID (prefix match supported)')
    .option('--json', 'Output as JSON')
    .action(async (runId, options) => {
      try {
        const store = new PlansStore(getConfigDir(getConfigPath()));
        const run = store.getRun(runId);

        if (!run) {
          outputError(`Run not found: ${runId}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(run, null, 2));
          return;
        }

        console.log(`Run ID: ${run.run_id}`);
        console.log(`Plan: ${run.plan_name || '(deleted)'}`);
        console.log(`Plan Digest: ${run.plan_digest}`);
        console.log(`Connector: ${run.connector_id}`);
        console.log(`Status: ${run.status}`);
        console.log(`Started: ${run.started_at}`);
        if (run.ended_at) {
          console.log(`Ended: ${run.ended_at}`);
        }
        console.log(`Artifact Path: ${run.artifact_path}`);
      } catch (error) {
        outputError('Failed to show run', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
