/**
 * Plan run artifacts generation
 * Phase 5.2: Write run results to artifact directory
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { RunMeta, RunResult, StepResult, RunInventory, PlanDefinition } from './schema.js';

/**
 * Artifact file names
 */
export const ARTIFACT_FILES = {
  META: 'meta.json',
  PLAN: 'plan.yaml',
  PLAN_ORIGINAL: 'plan.original.yaml',
  RUN_LOG: 'run.log',
  RESULTS: 'results.json',
  INVENTORY: 'inventory.json',
} as const;

/**
 * Create artifact directory and return its path
 */
export function createArtifactDir(configDir: string, runId: string): string {
  const artifactPath = join(configDir, 'artifacts', runId);
  mkdirSync(artifactPath, { recursive: true });
  return artifactPath;
}

/**
 * Write run metadata
 */
export function writeMetaJson(artifactPath: string, meta: RunMeta): void {
  const filePath = join(artifactPath, ARTIFACT_FILES.META);
  writeFileSync(filePath, JSON.stringify(meta, null, 2));
}

/**
 * Write normalized plan YAML
 */
export function writePlanYaml(artifactPath: string, normalizedYaml: string): void {
  const filePath = join(artifactPath, ARTIFACT_FILES.PLAN);
  writeFileSync(filePath, normalizedYaml);
}

/**
 * Write original plan YAML
 */
export function writeOriginalPlanYaml(artifactPath: string, originalYaml: string): void {
  const filePath = join(artifactPath, ARTIFACT_FILES.PLAN_ORIGINAL);
  writeFileSync(filePath, originalYaml);
}

/**
 * Write human-readable run log
 */
export function writeRunLog(artifactPath: string, log: string): void {
  const filePath = join(artifactPath, ARTIFACT_FILES.RUN_LOG);
  writeFileSync(filePath, log);
}

/**
 * Write step results JSON
 */
export function writeResultsJson(artifactPath: string, results: StepResult[]): void {
  const filePath = join(artifactPath, ARTIFACT_FILES.RESULTS);
  writeFileSync(filePath, JSON.stringify(results, null, 2));
}

/**
 * Write inventory JSON
 */
export function writeInventoryJson(artifactPath: string, inventory: RunInventory): void {
  const filePath = join(artifactPath, ARTIFACT_FILES.INVENTORY);
  writeFileSync(filePath, JSON.stringify(inventory, null, 2));
}

/**
 * Generate human-readable run log from results
 */
export function generateRunLog(result: RunResult, def: PlanDefinition): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push(`Plan Run: ${result.planName}`);
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Run ID:     ${result.runId}`);
  lines.push(`Connector:  ${result.connectorId}`);
  lines.push(`Status:     ${result.status.toUpperCase()}`);
  lines.push(`Started:    ${result.startedAt}`);
  lines.push(`Ended:      ${result.endedAt}`);
  lines.push(`Duration:   ${calculateDuration(result.startedAt, result.endedAt)}ms`);
  lines.push('');

  // Plan info
  if (def.description) {
    lines.push(`Description: ${def.description}`);
    lines.push('');
  }

  // Steps summary
  lines.push('───────────────────────────────────────────────────────────');
  lines.push('Steps Summary');
  lines.push('───────────────────────────────────────────────────────────');

  const passed = result.steps.filter(s => !s.skipped && s.response?.result !== undefined && !s.response?.error).length;
  const failed = result.steps.filter(s => !s.skipped && s.response?.error !== undefined).length;
  const skipped = result.steps.filter(s => s.skipped).length;

  lines.push(`Total:   ${result.steps.length}`);
  lines.push(`Passed:  ${passed}`);
  lines.push(`Failed:  ${failed}`);
  lines.push(`Skipped: ${skipped}`);
  lines.push('');

  // Step details
  lines.push('───────────────────────────────────────────────────────────');
  lines.push('Step Details');
  lines.push('───────────────────────────────────────────────────────────');

  for (const step of result.steps) {
    const status = step.skipped ? 'SKIP' :
                   step.response?.error ? 'FAIL' : 'PASS';
    const statusIcon = status === 'PASS' ? '[OK]' :
                       status === 'FAIL' ? '[NG]' : '[--]';

    lines.push('');
    lines.push(`${statusIcon} Step ${step.stepIndex + 1}: ${step.method}`);
    lines.push(`    Duration: ${step.durationMs}ms`);

    if (step.skipped && step.skipReason) {
      lines.push(`    Skipped: ${step.skipReason}`);
    }

    if (step.response?.error) {
      const err = step.response.error as { code?: number; message?: string };
      lines.push(`    Error: ${err.message || JSON.stringify(err)}`);
    }
  }

  lines.push('');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push('Inventory');
  lines.push('───────────────────────────────────────────────────────────');

  if (result.inventory.capabilities) {
    lines.push(`Capabilities: ${JSON.stringify(result.inventory.capabilities)}`);
  }
  if (result.inventory.tools) {
    lines.push(`Tools: ${result.inventory.tools.length} item(s)`);
  }
  if (result.inventory.resources) {
    lines.push(`Resources: ${result.inventory.resources.length} item(s)`);
  }
  if (result.inventory.prompts) {
    lines.push(`Prompts: ${result.inventory.prompts.length} item(s)`);
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('End of Run');
  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Calculate duration between two ISO timestamps
 */
function calculateDuration(start: string, end: string): number {
  return new Date(end).getTime() - new Date(start).getTime();
}

/**
 * Write all artifacts for a completed run
 */
export function writeAllArtifacts(
  configDir: string,
  result: RunResult,
  def: PlanDefinition,
  originalYaml: string,
  normalizedYaml: string
): string {
  const artifactPath = createArtifactDir(configDir, result.runId);

  // Calculate stats
  const passed = result.steps.filter(s => !s.skipped && s.response?.result !== undefined && !s.response?.error).length;
  const failed = result.steps.filter(s => !s.skipped && s.response?.error !== undefined).length;
  const skipped = result.steps.filter(s => s.skipped).length;

  // Write meta.json
  const meta: RunMeta = {
    runId: result.runId,
    planName: result.planName,
    planDigest: result.planDigest,
    connectorId: result.connectorId,
    status: result.status,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    totalSteps: result.steps.length,
    passedSteps: passed,
    failedSteps: failed,
    skippedSteps: skipped,
    artifactPath: `artifacts/${result.runId}`,
  };
  writeMetaJson(artifactPath, meta);

  // Write plan files
  writePlanYaml(artifactPath, normalizedYaml);
  writeOriginalPlanYaml(artifactPath, originalYaml);

  // Write results.json
  writeResultsJson(artifactPath, result.steps);

  // Write inventory.json
  writeInventoryJson(artifactPath, result.inventory);

  // Write run.log
  const runLog = generateRunLog(result, def);
  writeRunLog(artifactPath, runLog);

  return artifactPath;
}
