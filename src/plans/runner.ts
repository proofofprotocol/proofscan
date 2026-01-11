/**
 * Plan runner - executes validation plans against MCP servers
 * Phase 5.2: MCP validation scenario execution
 */

import { ulid } from 'ulid';
import type { Connector, StdioTransport } from '../types/index.js';
import { StdioConnection, JsonRpcResponse } from '../transports/stdio.js';
import type { Plan, PlanDefinition, PlanStep, StepResult, RunResult, RunInventory, RunStatus } from './schema.js';
import { PlansStore } from './store.js';
import { writeAllArtifacts } from './artifacts.js';
import { normalizePlanForDigest } from './digest.js';

export interface RunOptions {
  /** Timeout per step in seconds */
  timeout?: number;
  /** Custom output directory (overrides default artifacts dir) */
  outDir?: string;
  /** Dry run mode - don't save to DB or write artifacts */
  dryRun?: boolean;
}

export class PlanRunner {
  private configDir: string;
  private store: PlansStore;

  constructor(configDir: string) {
    this.configDir = configDir;
    this.store = new PlansStore(configDir);
  }

  /**
   * Run a plan against a connector
   */
  async run(
    plan: Plan,
    connector: Connector,
    options: RunOptions = {}
  ): Promise<RunResult> {
    const timeout = (options.timeout || 30) * 1000;
    const dryRun = options.dryRun || false;

    const runId = ulid();
    const startedAt = new Date().toISOString();

    // Parse plan definition
    const def = JSON.parse(JSON.stringify(
      await import('yaml').then(yaml => yaml.parse(plan.content_yaml))
    )) as PlanDefinition;

    // Create run record in DB (unless dry run)
    if (!dryRun) {
      this.store.createRun({
        runId,
        planName: plan.name,
        planDigest: plan.digest_sha256,
        connectorId: connector.id,
        artifactPath: `artifacts/${runId}`,
      });
    }

    const steps: StepResult[] = [];
    const inventory: RunInventory = {};
    let finalStatus: 'completed' | 'failed' | 'partial' = 'completed';

    // Check transport type
    if (connector.transport.type !== 'stdio') {
      const endedAt = new Date().toISOString();
      const errorResult: RunResult = {
        runId,
        planName: plan.name,
        planDigest: plan.digest_sha256,
        connectorId: connector.id,
        status: 'failed',
        steps: [],
        inventory,
        startedAt,
        endedAt,
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
      // Connect to MCP server
      await connection.connect();

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
    } finally {
      connection.close();
    }

    const endedAt = new Date().toISOString();

    const result: RunResult = {
      runId,
      planName: plan.name,
      planDigest: plan.digest_sha256,
      connectorId: connector.id,
      status: finalStatus,
      steps,
      inventory,
      startedAt,
      endedAt,
    };

    // Complete run in DB and write artifacts (unless dry run)
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
            name: 'proofscan-plans',
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
