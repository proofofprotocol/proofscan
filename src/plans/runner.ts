/**
 * Plan runner - executes validation plans against MCP servers
 * Phase 5.2: MCP validation scenario execution
 * Phase 5.3: Unified session recording (events.db + proofs.db)
 */

import { ulid } from 'ulid';
import type { Connector, StdioTransport } from '../types/index.js';
import { StdioConnection, JsonRpcResponse, JsonRpcMessage } from '../transports/stdio.js';
import type { Plan, PlanDefinition, PlanStep, StepResult, RunResult, RunInventory, RunStatus } from './schema.js';
import { PlansStore } from './store.js';
import { EventsStore } from '../db/events-store.js';
import { writeAllArtifacts } from './artifacts.js';
import { normalizePlanForDigest } from './digest.js';
import type { EventDirection, EventKind } from '../db/types.js';

export interface RunOptions {
  /** Timeout per step in seconds */
  timeout?: number;
  /** Custom output directory (overrides default artifacts dir) */
  outDir?: string;
  /** Dry run mode - don't save to DB or write artifacts */
  dryRun?: boolean;
}

export interface RunResultWithSession extends RunResult {
  /** Session ID in events.db (for navigation in shell) */
  sessionId?: string;
}

export class PlanRunner {
  private configDir: string;
  private store: PlansStore;
  private eventsStore: EventsStore;

  constructor(configDir: string) {
    this.configDir = configDir;
    this.store = new PlansStore(configDir);
    this.eventsStore = new EventsStore(configDir);
  }

  /**
   * Run a plan against a connector
   * Records session in both proofs.db (runs table) and events.db (sessions/events)
   */
  async run(
    plan: Plan,
    connector: Connector,
    options: RunOptions = {}
  ): Promise<RunResultWithSession> {
    const timeout = (options.timeout || 30) * 1000;
    const dryRun = options.dryRun || false;

    const runId = ulid();
    const startedAt = new Date().toISOString();

    // Parse plan definition
    const def = JSON.parse(JSON.stringify(
      await import('yaml').then(yaml => yaml.parse(plan.content_yaml))
    )) as PlanDefinition;

    // Create run record in proofs.db (unless dry run)
    if (!dryRun) {
      this.store.createRun({
        runId,
        planName: plan.name,
        planDigest: plan.digest_sha256,
        connectorId: connector.id,
        artifactPath: `artifacts/${runId}`,
      });
    }

    // Create session in events.db (unless dry run)
    const session = dryRun
      ? { session_id: `dry-run-${Date.now()}` }
      : this.eventsStore.createSession(connector.id);
    const sessionId = session.session_id;

    // Track RPC calls for events.db
    const rpcIdMap = new Map<string | number, string>();

    const steps: StepResult[] = [];
    const inventory: RunInventory = {};
    let finalStatus: 'completed' | 'failed' | 'partial' = 'completed';

    // Check transport type
    if (connector.transport.type !== 'stdio') {
      const endedAt = new Date().toISOString();

      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
          rawJson: JSON.stringify({ type: 'error', message: `Unsupported transport type: ${connector.transport.type}` }),
        });
        this.eventsStore.endSession(sessionId, 'error');
      }

      const errorResult: RunResultWithSession = {
        runId,
        planName: plan.name,
        planDigest: plan.digest_sha256,
        connectorId: connector.id,
        status: 'failed',
        steps: [],
        inventory,
        startedAt,
        endedAt,
        sessionId: dryRun ? undefined : sessionId,
      };

      if (!dryRun) {
        this.store.completeRun(runId, 'failed');
        writeAllArtifacts(
          options.outDir || this.configDir,
          errorResult,
          def,
          plan.content_yaml,
          plan.content_normalized
        );
      }

      return errorResult;
    }

    const transport = connector.transport as StdioTransport;
    const connection = new StdioConnection(transport);

    try {
      // Log connection attempt
      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
          rawJson: JSON.stringify({
            type: 'connect_attempt',
            command: transport.command,
            args: transport.args,
            plan: plan.name,
            runId,
          }),
        });
      }

      // Set up message logging for events.db
      connection.on('message', (msg: JsonRpcMessage, raw: string) => {
        if (dryRun) return;

        const isRequest = 'method' in msg && 'id' in msg && msg.id !== null;
        const isNotification = 'method' in msg && !('id' in msg);
        const isResponse = 'id' in msg && !('method' in msg);

        const direction: EventDirection = isResponse ? 'server_to_client' :
          (isRequest || isNotification) && !('id' in msg && 'result' in msg) ? 'client_to_server' : 'server_to_client';

        let kind: EventKind;
        if (isRequest) kind = 'request';
        else if (isNotification) kind = 'notification';
        else if (isResponse) kind = 'response';
        else kind = 'transport_event';

        let rpcId: string | undefined;

        // Handle RPC tracking
        if (isRequest && 'id' in msg && msg.id !== null && 'method' in msg) {
          const rpcCall = this.eventsStore.saveRpcCall(sessionId, String(msg.id), msg.method);
          rpcIdMap.set(msg.id, rpcCall.rpc_id);
          rpcId = rpcCall.rpc_id;
        } else if (isResponse && 'id' in msg && msg.id !== null) {
          rpcId = rpcIdMap.get(msg.id);
          if (rpcId) {
            const resp = msg as JsonRpcResponse;
            this.eventsStore.completeRpcCall(
              sessionId,
              String(msg.id),
              !resp.error,
              resp.error?.code
            );
          }
        }

        this.eventsStore.saveEvent(sessionId, direction, kind, {
          rpcId: rpcId || (('id' in msg && msg.id !== null) ? String(msg.id) : undefined),
          rawJson: raw,
        });
      });

      connection.on('stderr', (data: string) => {
        if (!dryRun) {
          this.eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
            rawJson: JSON.stringify({ type: 'stderr', data: data.trim() }),
          });
        }
      });

      connection.on('error', (error: Error) => {
        if (!dryRun) {
          this.eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
            rawJson: JSON.stringify({ type: 'error', message: error.message }),
          });
        }
      });

      // Connect to MCP server
      await connection.connect();

      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'server_to_client', 'transport_event', {
          rawJson: JSON.stringify({ type: 'connected' }),
        });
      }

      // Execute each step
      for (let i = 0; i < def.steps.length; i++) {
        const step = def.steps[i];
        const stepResult = await this.executeStep(
          connection,
          step,
          i,
          inventory,
          timeout
        );

        steps.push(stepResult);

        // Update inventory based on response
        if (!stepResult.skipped && stepResult.response?.result) {
          this.updateInventory(inventory, step.mcp, stepResult.response.result);
        }

        // Track failures
        if (!stepResult.skipped && stepResult.response?.error) {
          if (finalStatus === 'completed') {
            finalStatus = 'partial';
          }
        }
      }

      // Check if all non-skipped steps failed
      const executed = steps.filter(s => !s.skipped);
      const failed = executed.filter(s => s.response?.error);
      if (executed.length > 0 && failed.length === executed.length) {
        finalStatus = 'failed';
      }

    } catch (err) {
      // Fatal error during execution
      finalStatus = 'failed';
      const errorStep: StepResult = {
        stepIndex: steps.length,
        method: 'execution_error',
        skipped: false,
        request: { method: 'execution_error', params: {} },
        response: { error: { message: err instanceof Error ? err.message : String(err) } },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 0,
      };
      steps.push(errorStep);

      if (!dryRun) {
        this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
          rawJson: JSON.stringify({ type: 'execution_error', error: err instanceof Error ? err.message : String(err) }),
        });
      }
    } finally {
      connection.close();
    }

    const endedAt = new Date().toISOString();

    // End session in events.db
    if (!dryRun) {
      this.eventsStore.saveEvent(sessionId, 'client_to_server', 'transport_event', {
        rawJson: JSON.stringify({ type: 'disconnected', plan: plan.name, runId, status: finalStatus }),
      });
      this.eventsStore.endSession(sessionId, finalStatus === 'failed' ? 'error' : 'normal');
    }

    const result: RunResultWithSession = {
      runId,
      planName: plan.name,
      planDigest: plan.digest_sha256,
      connectorId: connector.id,
      status: finalStatus,
      steps,
      inventory,
      startedAt,
      endedAt,
      sessionId: dryRun ? undefined : sessionId,
    };

    // Complete run in proofs.db and write artifacts (unless dry run)
    if (!dryRun) {
      this.store.completeRun(runId, finalStatus);
      writeAllArtifacts(
        options.outDir || this.configDir,
        result,
        def,
        plan.content_yaml,
        plan.content_normalized
      );
    }

    return result;
  }

  /**
   * Execute a single plan step
   */
  private async executeStep(
    connection: StdioConnection,
    step: PlanStep,
    index: number,
    inventory: RunInventory,
    timeout: number
  ): Promise<StepResult> {
    const startedAt = new Date().toISOString();

    // Check when condition
    if (step.when) {
      const shouldExecute = this.evaluateWhenCondition(step.when, inventory);
      if (!shouldExecute) {
        const endedAt = new Date().toISOString();
        return {
          stepIndex: index,
          method: step.mcp,
          skipped: true,
          skipReason: `Condition not met: ${step.when}`,
          request: { method: step.mcp, params: {} },
          startedAt,
          endedAt,
          durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
        };
      }
    }

    // Build request params based on method
    const params = this.buildRequestParams(step.mcp);

    try {
      const response = await connection.sendRequest(step.mcp, params, timeout);
      const endedAt = new Date().toISOString();

      return {
        stepIndex: index,
        method: step.mcp,
        skipped: false,
        request: { method: step.mcp, params },
        response: {
          result: response.result,
          error: response.error,
        },
        startedAt,
        endedAt,
        durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
      };
    } catch (err) {
      const endedAt = new Date().toISOString();

      return {
        stepIndex: index,
        method: step.mcp,
        skipped: false,
        request: { method: step.mcp, params },
        response: {
          error: {
            code: -1,
            message: err instanceof Error ? err.message : String(err),
          },
        },
        startedAt,
        endedAt,
        durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
      };
    }
  }

  /**
   * Build request params for MCP method
   */
  private buildRequestParams(method: string): Record<string, unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'proofscan',
            version: '1.0.0',
          },
        };
      case 'tools/list':
      case 'resources/list':
      case 'prompts/list':
        return {};
      default:
        return {};
    }
  }

  /**
   * Evaluate a when condition against current inventory
   */
  private evaluateWhenCondition(condition: string, inventory: RunInventory): boolean {
    // Parse condition: capabilities.<field>
    const match = condition.match(/^capabilities\.(\w+)$/);
    if (!match) {
      return false;
    }

    const field = match[1];
    const capabilities = inventory.capabilities as Record<string, unknown> | undefined;

    if (!capabilities) {
      return false;
    }

    // Check if field exists and is truthy
    const value = capabilities[field];
    return value !== undefined && value !== null && value !== false;
  }

  /**
   * Update inventory based on response
   */
  private updateInventory(inventory: RunInventory, method: string, result: unknown): void {
    switch (method) {
      case 'initialize': {
        const initResult = result as { capabilities?: unknown };
        if (initResult.capabilities) {
          inventory.capabilities = initResult.capabilities;
        }
        break;
      }
      case 'tools/list': {
        const toolsResult = result as { tools?: unknown[] };
        if (toolsResult.tools) {
          inventory.tools = toolsResult.tools;
        }
        break;
      }
      case 'resources/list': {
        const resourcesResult = result as { resources?: unknown[] };
        if (resourcesResult.resources) {
          inventory.resources = resourcesResult.resources;
        }
        break;
      }
      case 'prompts/list': {
        const promptsResult = result as { prompts?: unknown[] };
        if (promptsResult.prompts) {
          inventory.prompts = promptsResult.prompts;
        }
        break;
      }
    }
  }
}
