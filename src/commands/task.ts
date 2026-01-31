/**
 * Task Commands (A2A Phase 2.2)
 *
 * CLI commands for managing A2A tasks.
 * Implements: ls, get, cancel, wait
 */

import { Command } from 'commander';
import { createA2AClient } from '../a2a/client.js';
import { output, outputError, outputSuccess, outputTable } from '../utils/output.js';
import type { Task, TaskState, ListTasksParams } from '../a2a/types.js';

/**
 * Handle task list logic (shared by ls and list commands)
 */
async function handleTaskList(
  agent: string,
  options: { context?: string; status?: string },
  getConfigPath: () => string
): Promise<void> {
  // Validate status if provided
  const validStatuses: TaskState[] = ['pending', 'working', 'input_required', 'completed', 'failed', 'canceled', 'rejected'];
  if (options.status && !validStatuses.includes(options.status as TaskState)) {
    outputError(`Invalid status: ${options.status}. Valid values: ${validStatuses.join(', ')}`);
    process.exit(1);
  }

  // Build list params
  const params: ListTasksParams = {};
  if (options.context) {
    params.contextId = options.context;
  }
  if (options.status) {
    params.status = options.status as TaskState;
  }

  // Create client
  const configDir = getConfigPath();
  const clientResult = await createA2AClient(configDir, agent);

  if (!clientResult.ok) {
    if (clientResult.error?.includes('ECONNREFUSED') || clientResult.error?.includes('fetch failed')) {
      outputError(`Cannot connect to agent. Is it running? (${clientResult.error})`);
    } else {
      outputError(clientResult.error || 'Failed to create client');
    }
    process.exit(1);
  }

  // List tasks
  const result = await clientResult.client.listTasks(params);

  if (!result.ok) {
    // Provide more specific error messages
    if (result.error?.includes('ECONNREFUSED') || result.error?.includes('fetch failed')) {
      outputError(`Cannot connect to agent. Is it running? (${result.error})`);
    } else if (result.error?.includes('404') || result.error?.includes('not found')) {
      outputError(`Agent does not support tasks/list endpoint. (${result.error})`);
    } else {
      outputError(result.error || 'Failed to list tasks');
    }
    process.exit(1);
  }

  if (!result.response) {
    outputError('Failed to list tasks: no response from agent');
    process.exit(1);
  }

  const { tasks, totalSize } = result.response;

  if (tasks.length === 0) {
    output({ tasks: [], totalSize }, 'No tasks found.');
    return;
  }

  // Output as table
  const headers = ['ID', 'Status', 'Context', 'Messages', 'Created'];
  const rows = tasks.map(t => [
    t.id.slice(0, 8),
    t.status,
    t.contextId || '-',
    t.messages ? String(t.messages.length) : '0',
    t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '-',
  ]);

  outputTable(headers, rows);

  // Show total size if available
  if (totalSize !== undefined && totalSize > tasks.length) {
    console.log(`\nShowing ${tasks.length} of ${totalSize} tasks (first page)`);
  }
}

/**
 * Create the task command group
 */
export function createTaskCommand(getConfigPath: () => string): Command {
  const cmd = new Command('task')
    .description('Manage A2A tasks');

  // ===== task ls =====
  cmd
    .command('ls <agent>')
    .description('List tasks for an agent')
    .option('--context <id>', 'Filter by context ID')
    .option('--status <state>', 'Filter by status (pending|working|input_required|completed|failed|canceled|rejected)')
    .action(async (agent, options) => {
      try {
        await handleTaskList(agent, options, getConfigPath);
      } catch (error) {
        outputError('Failed to list tasks', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== task list =====
  cmd
    .command('list <agent>')
    .description('Alias for ls')
    .option('--context <id>', 'Filter by context ID')
    .option('--status <state>', 'Filter by status')
    .action(async (agent, options) => {
      try {
        await handleTaskList(agent, options, getConfigPath);
      } catch (error) {
        outputError('Failed to list tasks', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== task get =====
  cmd
    .command('get <agent> <taskId>')
    .description('Get task details')
    .option('--history <n>', 'Message history length (number of recent messages)', '10')
    .action(async (agent, taskId, options) => {
      try {
        // Parse history length
        const historyLength = parseInt(options.history, 10);
        if (isNaN(historyLength) || historyLength < 0) {
          outputError('History length must be a non-negative integer');
          process.exit(1);
        }

        // Create client
        const configDir = getConfigPath();
        const clientResult = await createA2AClient(configDir, agent);

        if (!clientResult.ok) {
          if (clientResult.error?.includes('ECONNREFUSED') || clientResult.error?.includes('fetch failed')) {
            outputError(`Cannot connect to agent. Is it running? (${clientResult.error})`);
          } else {
            outputError(clientResult.error || 'Failed to create client');
          }
          process.exit(1);
        }

        // Get task
        const result = await clientResult.client.getTask(taskId, { historyLength });

        if (!result.ok) {
          if (result.error?.includes('404') || result.error?.includes('not found')) {
            outputError(`Task not found: ${taskId} (${result.error})`);
          } else {
            outputError(result.error || `Failed to get task: ${taskId}`);
          }
          process.exit(1);
        }

        if (!result.task) {
          outputError(`Task not found: ${taskId}`);
          process.exit(1);
        }

        const task = result.task;

        // Build output
        const outputData = {
          id: task.id,
          status: task.status,
          contextId: task.contextId,
          messageCount: task.messages?.length ?? 0,
          artifactCount: task.artifacts?.length ?? 0,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          messages: historyLength > 0 ? task.messages?.slice(-historyLength) : [],
          artifacts: task.artifacts,
        };

        output(outputData);
      } catch (error) {
        outputError('Failed to get task', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== task cancel =====
  cmd
    .command('cancel <agent> <taskId>')
    .description('Cancel a task')
    .action(async (agent, taskId, options) => {
      try {
        // Create client
        const configDir = getConfigPath();
        const clientResult = await createA2AClient(configDir, agent);

        if (!clientResult.ok) {
          if (clientResult.error?.includes('ECONNREFUSED') || clientResult.error?.includes('fetch failed')) {
            outputError(`Cannot connect to agent. Is it running? (${clientResult.error})`);
          } else {
            outputError(clientResult.error || 'Failed to create client');
          }
          process.exit(1);
        }

        // Cancel task
        const result = await clientResult.client.cancelTask(taskId);

        if (!result.ok) {
          if (result.error?.includes('404') || result.error?.includes('not found')) {
            outputError(`Task not found: ${taskId} (${result.error})`);
          } else if (result.error?.includes('already')) {
            outputError(`Task already canceled or in final state: ${taskId} (${result.error})`);
          } else {
            outputError(result.error || `Failed to cancel task: ${taskId}`);
          }
          process.exit(1);
        }

        if (result.task) {
          const canceledTask = {
            id: result.task.id,
            status: result.task.status,
            updatedAt: result.task.updatedAt,
          };
          outputSuccess(`Task '${taskId}' canceled`, canceledTask);
        } else {
          outputSuccess(`Task '${taskId}' canceled`);
        }
      } catch (error) {
        outputError('Failed to cancel task', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  // ===== task wait =====
  cmd
    .command('wait <agent> <taskId>')
    .description('Wait for task completion (poll until completed/failed/canceled/rejected)')
    .option('--timeout <sec>', 'Timeout in seconds (default: 60)', '60')
    .option('--interval <sec>', 'Poll interval in seconds (default: 2)', '2')
    .action(async (agent, taskId, options) => {
      try {
        // Parse options
        const timeoutSec = parseInt(options.timeout, 10);
        const intervalSec = parseInt(options.interval, 10);

        if (isNaN(timeoutSec) || timeoutSec <= 0) {
          outputError('Timeout must be a positive integer');
          process.exit(1);
        }

        if (isNaN(intervalSec) || intervalSec <= 0) {
          outputError('Interval must be a positive integer');
          process.exit(1);
        }

        const startTime = Date.now();
        const timeoutMs = timeoutSec * 1000;
        const intervalMs = intervalSec * 1000;

        // Create client
        const configDir = getConfigPath();
        const clientResult = await createA2AClient(configDir, agent);

        if (!clientResult.ok) {
          if (clientResult.error?.includes('ECONNREFUSED') || clientResult.error?.includes('fetch failed')) {
            outputError(`Cannot connect to agent. Is it running? (${clientResult.error})`);
          } else {
            outputError(clientResult.error || 'Failed to create client');
          }
          process.exit(1);
        }

        const client = clientResult.client;
        const finalStatuses: TaskState[] = ['completed', 'failed', 'canceled', 'rejected'];

        // Poll loop
        while (true) {
          // Check timeout
          const elapsed = Date.now() - startTime;
          if (elapsed > timeoutMs) {
            outputError(`Timeout after ${timeoutSec}s`);
            process.exit(1);
          }

          // Get task status
          const result = await client.getTask(taskId);

          if (!result.ok) {
            if (result.error?.includes('404') || result.error?.includes('not found')) {
              outputError(`Task not found: ${taskId} (${result.error})`);
            } else {
              outputError(result.error || `Failed to get task status: ${taskId}`);
            }
            process.exit(1);
          }

          if (!result.task) {
            outputError(`Task not found: ${taskId}`);
            process.exit(1);
          }

          const task = result.task;

          // Check if final status
          if (finalStatuses.includes(task.status)) {
            output({
              id: task.id,
              status: task.status,
              messageCount: task.messages?.length ?? 0,
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
            });
            break;
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
      } catch (error) {
        outputError('Failed to wait for task', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  return cmd;
}
