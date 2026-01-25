/**
 * Agent Commands (A2A)
 *
 * CLI commands for managing A2A agents.
 * Phase 3 - CLI Implementation
 */

import { Command } from 'commander';
import { TargetsStore } from '../db/targets-store.js';
import { AgentCacheStore } from '../db/agent-cache-store.js';
import { output, outputError, outputSuccess, outputTable } from '../utils/output.js';
import { fetchAgentCard } from '../a2a/agent-card.js';
import type { AgentConfigV1 } from '../a2a/types.js';

/**
 * Create the agent command group
 */
export function createAgentCommand(getConfigPath: () => string): Command {
  const cmd = new Command('agent')
    .description('Manage A2A agents');

  // ===== agent add =====
  cmd
    .command('add')
    .description('Add a new A2A agent')
    .argument('<id>', 'Agent ID')
    .requiredOption('--url <url>', 'Agent base URL')
    .option('--name <name>', 'Agent display name')
    .option('--ttl <seconds>', 'Agent card cache TTL in seconds', '3600')
    .action(async (id, options) => {
      try {
        const configDir = getConfigPath();
        const store = new TargetsStore(configDir);

        // Check if ID already exists
        const existing = store.get(id);
        if (existing) {
          outputError(`Agent '${id}' already exists`);
          process.exit(1);
        }

        // Validate URL format
        try {
          new URL(options.url);
        } catch {
          outputError(`Invalid URL: ${options.url}`);
          process.exit(1);
        }

        // Parse TTL
        const ttlSeconds = parseInt(options.ttl, 10);
        if (isNaN(ttlSeconds) || ttlSeconds < 0) {
          outputError('TTL must be a non-negative integer');
          process.exit(1);
        }

        // Create AgentConfigV1
        const config: AgentConfigV1 = {
          schema_version: 1,
          url: options.url,
          ttl_seconds: ttlSeconds,
        };

        // Add to targets
        store.add({
          type: 'agent',
          protocol: 'a2a',
          name: options.name,
          enabled: true,
          config,
        });

        outputSuccess(`Agent '${id}' added`);
      } catch (error) {
        outputError('Failed to add agent', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== agent list =====
  const listAction = async (options: { all?: boolean }) => {
    try {
      const configDir = getConfigPath();
      const store = new TargetsStore(configDir);

      const agents = store.list({
        type: 'agent',
        ...(options.all ? {} : { enabled: true }),
      });

      if (agents.length === 0) {
        output({ agents: [] }, 'No agents found.');
        return;
      }

      const headers = ['ID', 'Name', 'URL', 'Enabled', 'Created'];
      const rows = agents.map(a => {
        const config = a.config as AgentConfigV1;
        let url = config.url || '';
        if (url.length > 40) url = url.slice(0, 37) + '...';
        return [
          a.id.slice(0, 8),
          a.name || '-',
          url,
          a.enabled ? 'yes' : 'no',
          new Date(a.createdAt).toLocaleDateString(),
        ];
      });

      outputTable(headers, rows);
    } catch (error) {
      outputError('Failed to list agents', error instanceof Error ? error : undefined);
      process.exit(1);
    }
  };

  cmd
    .command('ls')
    .description('List agents (enabled only)')
    .option('--all', 'Include disabled agents')
    .action(listAction);

  cmd
    .command('list')
    .description('Alias for ls')
    .option('--all', 'Include disabled agents')
    .action(listAction);

  // ===== agent show =====
  cmd
    .command('show')
    .description('Show agent details')
    .argument('<id>', 'Agent ID (or 8-char prefix)')
    .action(async (id) => {
      try {
        const configDir = getConfigPath();
        const store = new TargetsStore(configDir);
        const cacheStore = new AgentCacheStore(configDir);

        // Find agent by ID or prefix
        const agents = store.list({ type: 'agent' });
        const agent = agents.find(a => a.id === id || a.id.startsWith(id));

        if (!agent) {
          outputError(`Agent not found: ${id}`);
          process.exit(1);
        }

        const cache = cacheStore.get(agent.id);

        const result = {
          id: agent.id,
          name: agent.name,
          enabled: agent.enabled,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          config: agent.config,
          cache: cache ? {
            agentCard: cache.agentCard,
            fetchedAt: cache.fetchedAt,
            expiresAt: cache.expiresAt,
            hash: cache.agentCardHash,
          } : null,
        };

        output(result);
      } catch (error) {
        outputError('Failed to show agent', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== agent remove =====
  cmd
    .command('remove')
    .description('Remove an agent')
    .argument('<id>', 'Agent ID (or 8-char prefix)')
    .action(async (id) => {
      try {
        const configDir = getConfigPath();
        const store = new TargetsStore(configDir);

        // Find agent by ID or prefix
        const agents = store.list({ type: 'agent' });
        const agent = agents.find(a => a.id === id || a.id.startsWith(id));

        if (!agent) {
          outputError(`Agent not found: ${id}`);
          process.exit(1);
        }

        const removed = store.remove(agent.id);
        if (!removed) {
          outputError(`Failed to remove agent: ${id}`);
          process.exit(1);
        }

        outputSuccess(`Agent '${agent.id}' removed`);
      } catch (error) {
        outputError('Failed to remove agent', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== agent enable =====
  cmd
    .command('enable')
    .description('Enable an agent')
    .argument('<id>', 'Agent ID (or 8-char prefix)')
    .action(async (id) => {
      try {
        const configDir = getConfigPath();
        const store = new TargetsStore(configDir);

        // Find agent by ID or prefix
        const agents = store.list({ type: 'agent' });
        const agent = agents.find(a => a.id === id || a.id.startsWith(id));

        if (!agent) {
          outputError(`Agent not found: ${id}`);
          process.exit(1);
        }

        if (agent.enabled) {
          output(`Agent '${agent.id}' is already enabled`);
          return;
        }

        const updated = store.updateEnabled(agent.id, true);
        if (!updated) {
          outputError(`Failed to enable agent: ${id}`);
          process.exit(1);
        }

        outputSuccess(`Agent '${agent.id}' enabled`);
      } catch (error) {
        outputError('Failed to enable agent', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== agent disable =====
  cmd
    .command('disable')
    .description('Disable an agent')
    .argument('<id>', 'Agent ID (or 8-char prefix)')
    .action(async (id) => {
      try {
        const configDir = getConfigPath();
        const store = new TargetsStore(configDir);

        // Find agent by ID or prefix
        const agents = store.list({ type: 'agent' });
        const agent = agents.find(a => a.id === id || a.id.startsWith(id));

        if (!agent) {
          outputError(`Agent not found: ${id}`);
          process.exit(1);
        }

        if (!agent.enabled) {
          output(`Agent '${agent.id}' is already disabled`);
          return;
        }

        const updated = store.updateEnabled(agent.id, false);
        if (!updated) {
          outputError(`Failed to disable agent: ${id}`);
          process.exit(1);
        }

        outputSuccess(`Agent '${agent.id}' disabled`);
      } catch (error) {
        outputError('Failed to disable agent', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== agent scan =====
  cmd
    .command('scan')
    .description('Fetch and cache Agent Card')
    .argument('<id>', 'Agent ID (or 8-char prefix)')
    .option('--refresh', 'Ignore cache and re-fetch')
    .action(async (id, options) => {
      try {
        const configDir = getConfigPath();
        const store = new TargetsStore(configDir);
        const cacheStore = new AgentCacheStore(configDir);

        // Find agent by ID or prefix
        const agents = store.list({ type: 'agent' });
        const agent = agents.find(a => a.id === id || a.id.startsWith(id));

        if (!agent) {
          outputError(`Agent not found: ${id}`);
          process.exit(1);
        }

        const config = agent.config as AgentConfigV1;
        if (!config.url) {
          outputError(`Agent '${agent.id}' has no URL configured`);
          process.exit(1);
        }

        // Check cache if not refreshing
        if (!options.refresh) {
          const cache = cacheStore.get(agent.id);
          if (cache && cache.agentCard) {
            const isExpired = cache.expiresAt && new Date(cache.expiresAt) < new Date();
            if (!isExpired) {
              output(`Agent Card cached (expires: ${cache.expiresAt})`);
              output(cache.agentCard);
              return;
            }
          }
        }

        // Fetch Agent Card
        output(`Fetching Agent Card from ${config.url}...`);
        const result = await fetchAgentCard(config.url);

        if (!result.ok || !result.agentCard) {
          outputError(`Failed to fetch Agent Card: ${result.error}`);
          process.exit(1);
        }

        // Calculate expiration
        const ttlSeconds = config.ttl_seconds || 3600;
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

        // Save to cache
        cacheStore.set({
          targetId: agent.id,
          agentCard: result.agentCard,
          agentCardHash: result.hash,
          fetchedAt: new Date().toISOString(),
          expiresAt,
        });

        outputSuccess(`Agent Card cached (expires: ${expiresAt})`);
        output(result.agentCard);
      } catch (error) {
        outputError('Failed to scan agent', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
