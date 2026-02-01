/**
 * Task Commands (A2A Phase 2.2)
 *
 * CLI commands for managing A2A tasks.
 * Implements: ls, show, cancel, wait
 *
 * Phase 2.4: Task event recording
 */

import { Command } from 'commander';
import { dirname } from 'node:path';
import { createA2AClient } from '../a2a/client.js';
import { output, outputError, outputSuccess, outputTable } from '../utils/output.js';
import type { Task, TaskState, ListTasksParams } from '../a2a/types.js';
import { EventsStore } from '../db/events-store.js';

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
  const configDir = dirname(getConfigPath());
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
 * Get or create session for task event recording (Phase 2.4)
 *
 * Session resolution strategy:
 * 1. First, check for existing task events and reuse their session_id
 * 2. If no existing events, create a new session for the agent
 *
 * @param configDir - Configuration directory
 * @param agentId - Agent ID (connector/target ID)
 * @param taskId - Task ID (for finding existing events)
 * @returns Session ID for event recording
 */
function getOrCreateSessionForTask(configDir: string, agentId: string, taskId: string): string {
  const eventsStore = new EventsStore(configDir);

  // 1. Check for existing task events with this taskId
  const existingEvents = eventsStore.getTaskEventsByTaskId(taskId);
  if (existingEvents.length > 0) {
    return existingEvents[0].session_id;
  }

  // 2. No existing events - try to find a recent session for this agent
  const latestSession = eventsStore.getLatestSession(agentId);
  if (latestSession) {
    return latestSession.session_id;
  }

  // 3. Create a new session for this agent
  const session = eventsStore.createSession(agentId, {
    actorKind: 'system',
    actorLabel: 'cli-task',
  });

  return session.session_id;
}

/**
 * Record task status update event (Phase 2.4)
 *
 * @param configDir - Configuration directory
 * @param agentId - Agent ID
 * @param taskId - Task ID
 * @param status - Current task status
 * @returns True if event was recorded, false if status unchanged
 */
function recordTaskUpdate(
  configDir: string,
  agentId: string,
  taskId: string,
  status: string
): boolean {
  try {
    const sessionId = getOrCreateSessionForTask(configDir, agentId, taskId);
    const eventsStore = new EventsStore(configDir);
    return eventsStore.recordTaskUpdated(sessionId, taskId, status);
  } catch {
    // Silently fail to avoid blocking CLI operations
    return false;
  }
}

/**
 * Record task completion event (Phase 2.4)
 *
 * @param configDir - Configuration directory
 * @param agentId - Agent ID
 * @param taskId - Task ID
 * @param status - Final task status (completed/failed/canceled/rejected)
 * @param messages - Task messages (optional)
 * @param error - Error message (for failed status)
 */
function recordTaskCompletion(
  configDir: string,
  agentId: string,
  taskId: string,
  status: string,
  messages?: unknown,
  error?: string
): void {
  try {
    const sessionId = getOrCreateSessionForTask(configDir, agentId, taskId);
    const eventsStore = new EventsStore(configDir);

    if (status === 'completed') {
      eventsStore.recordTaskCompleted(sessionId, taskId, status, messages as any);
    } else if (status === 'failed') {
      eventsStore.recordTaskFailed(sessionId, taskId, status, error);
    } else if (status === 'canceled') {
      eventsStore.recordTaskCanceled(sessionId, taskId, status);
    } else if (status === 'rejected') {
      eventsStore.recordTaskFailed(sessionId, taskId, status, 'Task rejected');
    }
  } catch {
    // Silently fail to avoid blocking CLI operations
  }
}

/**
 * Record task wait timeout event (Phase 2.4)
 *
 * @param configDir - Configuration directory
 * @param agentId - Agent ID
 * @param taskId - Task ID
 * @param error - Error message
 */
function recordTaskTimeout(configDir: string, agentId: string, taskId: string, error?: string): void {
  try {
    const sessionId = getOrCreateSessionForTask(configDir, agentId, taskId);
    const eventsStore = new EventsStore(configDir);
    eventsStore.recordTaskWaitTimeout(sessionId, taskId, error);
  } catch {
    // Silently fail to avoid blocking CLI operations
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

  /**
   * Handler for task show with prefix matching
   */
  async function handleTaskShow(agent: string, taskIdPrefix: string, options: { history?: string }): Promise<void> {
    // Parse history length
    const historyLength = parseInt(options.history || '10', 10);
    if (isNaN(historyLength) || historyLength < 0) {
      outputError('History length must be a non-negative integer');
      process.exit(1);
    }

    // Create client
    const configDir = dirname(getConfigPath());
    const clientResult = await createA2AClient(configDir, agent);

    if (!clientResult.ok) {
      if (clientResult.error?.includes('ECONNREFUSED') || clientResult.error?.includes('fetch failed')) {
        outputError(`Cannot connect to agent. Is it running? (${clientResult.error})`);
      } else {
        outputError(clientResult.error || 'Failed to create client');
      }
      process.exit(1);
    }

    // First try exact match
    let result = await clientResult.client.getTask(taskIdPrefix, { historyLength });

    // If not found, try prefix matching via list
    if (!result.ok && (result.error?.includes('not found') || result.error?.includes('-32001'))) {
      const listResult = await clientResult.client.listTasks({});
      if (listResult.ok && listResult.response) {
        const matches = listResult.response.tasks.filter(t => t.id.startsWith(taskIdPrefix));
        if (matches.length === 1) {
          // Exactly one match - use full ID
          result = await clientResult.client.getTask(matches[0].id, { historyLength });
        } else if (matches.length > 1) {
          outputError(`Ambiguous task ID prefix '${taskIdPrefix}'. Matches: ${matches.map(t => t.id).join(', ')}`);
          process.exit(1);
        }
        // If no matches, fall through to original error
      }
    }

    if (!result.ok) {
      if (result.error?.includes('404') || result.error?.includes('not found') || result.error?.includes('-32001')) {
        outputError(`Task not found: ${taskIdPrefix} (${result.error})`);
      } else {
        outputError(result.error || `Failed to get task: ${taskIdPrefix}`);
      }
      process.exit(1);
    }

    if (!result.task) {
      outputError(`Task not found: ${taskIdPrefix}`);
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
  }

  // ===== task show =====
  cmd
    .command('show <agent> <taskId>')
    .description('Show task details')
    .option('--history <n>', 'Message history length', '10')
    .action(async (agent, taskId, options) => {
      try {
        await handleTaskShow(agent, taskId, options);
      } catch (error) {
        outputError('Failed to get task', error instanceof Error ? error : undefined);
        process.exit(1);
      }
    });

  /**
   * Resolve task ID prefix to full ID
   */
  async function resolveTaskId(client: { listTasks: (params: ListTasksParams) => Promise<{ ok: boolean; response?: { tasks: Task[] } }> }, taskIdPrefix: string): Promise<string | null> {
    // First try to list tasks and find matches
    const listResult = await client.listTasks({});
    if (!listResult.ok || !listResult.response) {
      return taskIdPrefix; // Fall back to original
    }
    
    const matches = listResult.response.tasks.filter((t: Task) => t.id.startsWith(taskIdPrefix));
    if (matches.length === 1) {
      return matches[0].id;
    } else if (matches.length > 1) {
      outputError(`Ambiguous task ID prefix '${taskIdPrefix}'. Matches: ${matches.map((t: Task) => t.id).join(', ')}`);
      process.exit(1);
    }
    
    return taskIdPrefix; // No matches, return as-is
  }

  // ===== task cancel =====
  cmd
    .command('cancel <agent> <taskId>')
    .description('Cancel a task')
    .action(async (agent, taskIdPrefix) => {
      try {
        // Create client
        const configDir = dirname(getConfigPath());
        const clientResult = await createA2AClient(configDir, agent);

        if (!clientResult.ok) {
          if (clientResult.error?.includes('ECONNREFUSED') || clientResult.error?.includes('fetch failed')) {
            outputError(`Cannot connect to agent. Is it running? (${clientResult.error})`);
          } else {
            outputError(clientResult.error || 'Failed to create client');
          }
          process.exit(1);
        }

        // Resolve task ID prefix
        const taskId = await resolveTaskId(clientResult.client, taskIdPrefix);
        if (!taskId) {
          outputError(`Task not found: ${taskIdPrefix}`);
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

        // Record task cancellation event
        if (result.task) {
          recordTaskCompletion(configDir, agent, taskId, result.task.status);
          const canceledTask = {
            id: result.task.id,
            status: result.task.status,
            updatedAt: result.task.updatedAt,
          };
          outputSuccess(`Task '${taskId}' canceled`, canceledTask);
        } else {
          // No task returned but cancel succeeded
          recordTaskCompletion(configDir, agent, taskId, 'canceled');
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
    .option('--follow', 'Show new messages in real-time while waiting')
    .action(async (agent, taskIdPrefix, options) => {
      try {
        // Parse options
        const timeoutSec = parseInt(options.timeout, 10);
        const intervalSec = parseInt(options.interval, 10);
        const follow = options.follow === true;

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
        const configDir = dirname(getConfigPath());
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

        // Resolve task ID prefix
        const taskId = await resolveTaskId(client, taskIdPrefix);
        if (!taskId) {
          outputError(`Task not found: ${taskIdPrefix}`);
          process.exit(1);
        }

        // Track last seen message count for --follow
        let lastMessageCount = 0;

        // Track last recorded status to avoid duplicate events
        let lastRecordedStatus: string | null = null;

        // Initial fetch to get baseline
        const initialResult = await client.getTask(taskId);
        if (initialResult.ok && initialResult.task) {
          lastMessageCount = initialResult.task.messages?.length ?? 0;
          // Record initial status
          recordTaskUpdate(configDir, agent, taskId, initialResult.task.status);
          lastRecordedStatus = initialResult.task.status;
        }

        // Poll loop
        while (true) {
          // Check timeout
          const elapsed = Date.now() - startTime;
          if (elapsed > timeoutMs) {
            // Record timeout event
            recordTaskTimeout(configDir, agent, taskId, `Timeout after ${timeoutSec}s`);
            outputError(`Timeout after ${timeoutSec}s`);
            process.exit(1);
          }

          // Get task status
          const result = await client.getTask(taskId);

          if (!result.ok) {
            // Record poll error
            recordTaskTimeout(configDir, agent, taskId, result.error);
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

          // Record status update if changed
          if (lastRecordedStatus !== task.status) {
            recordTaskUpdate(configDir, agent, taskId, task.status);
            lastRecordedStatus = task.status;
          }

          // --follow: Show new messages since last check
          if (follow && task.messages && task.messages.length > lastMessageCount) {
            const newMessages = task.messages.slice(lastMessageCount);
            for (const msg of newMessages) {
              const timestamp = new Date().toLocaleTimeString(undefined, { hour12: false });
              // Extract text from parts
              const text = msg.parts
                ?.map(p => {
                  if ('text' in p && p.text) return p.text;
                  if ('data' in p) return `[${(p as { mimeType?: string }).mimeType || 'data'}]`;
                  return '';
                })
                .filter(Boolean)
                .join('') || '(no content)';
              console.log(`[${timestamp}] ${text}`);
            }
            lastMessageCount = task.messages.length;
          }

          // Check if final status
          if (finalStatuses.includes(task.status)) {
            // Record completion event
            recordTaskCompletion(configDir, agent, taskId, task.status, task.messages);
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
