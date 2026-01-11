/**
 * Plans store - manages plans and runs in proofs.db
 * Phase 5.2: CRUD operations for validation plans
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getProofsDb } from '../db/connection.js';
import { calculatePlanDigest, normalizePlanForDigest } from './digest.js';
import type { Plan, Run, RunStatus, PlanDefinition } from './schema.js';
import { validatePlanDefinition, isValidPlanName } from './schema.js';

export class PlansStore {
  private configDir?: string;

  constructor(configDir?: string) {
    this.configDir = configDir;
  }

  private get db() {
    return getProofsDb(this.configDir);
  }

  // ============================================================
  // Plans CRUD
  // ============================================================

  /**
   * List all plans
   */
  listPlans(): Plan[] {
    const stmt = this.db.prepare(`
      SELECT * FROM plans ORDER BY created_at DESC
    `);
    return stmt.all() as Plan[];
  }

  /**
   * Get plan by name
   */
  getPlan(name: string): Plan | null {
    const stmt = this.db.prepare(`SELECT * FROM plans WHERE name = ?`);
    const result = stmt.get(name) as Plan | undefined;
    return result ?? null;
  }

  /**
   * Check if plan exists
   */
  planExists(name: string): boolean {
    const stmt = this.db.prepare(`SELECT 1 FROM plans WHERE name = ?`);
    return stmt.get(name) !== undefined;
  }

  /**
   * Add a new plan from YAML content
   */
  addPlan(
    name: string,
    yamlContent: string,
    source: 'manual' | 'import' | 'builtin' = 'manual'
  ): { success: boolean; plan?: Plan; error?: string } {
    // Validate name
    if (!isValidPlanName(name)) {
      return { success: false, error: `Invalid plan name: must match [a-z0-9_-]+` };
    }

    // Check if exists
    if (this.planExists(name)) {
      return { success: false, error: `Plan '${name}' already exists` };
    }

    // Parse YAML
    let def: PlanDefinition;
    try {
      def = parseYaml(yamlContent) as PlanDefinition;
    } catch (err) {
      return { success: false, error: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Validate definition
    const validation = validatePlanDefinition(def);
    if (!validation.valid) {
      return { success: false, error: `Invalid plan: ${validation.errors.join('; ')}` };
    }

    // Calculate normalized content and digest
    const contentNormalized = normalizePlanForDigest(def);
    const digestSha256 = calculatePlanDigest(def);

    const now = new Date().toISOString();
    const plan: Plan = {
      name,
      schema_version: def.version,
      content_yaml: yamlContent,
      content_normalized: contentNormalized,
      digest_sha256: digestSha256,
      description: def.description || null,
      default_connector: null,
      source,
      created_at: now,
      updated_at: now,
    };

    try {
      const stmt = this.db.prepare(`
        INSERT INTO plans (
          name, schema_version, content_yaml, content_normalized, digest_sha256,
          description, default_connector, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        plan.name,
        plan.schema_version,
        plan.content_yaml,
        plan.content_normalized,
        plan.digest_sha256,
        plan.description,
        plan.default_connector,
        plan.source,
        plan.created_at,
        plan.updated_at
      );

      return { success: true, plan };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Update an existing plan
   */
  updatePlan(
    name: string,
    yamlContent: string
  ): { success: boolean; plan?: Plan; error?: string } {
    // Check if exists
    if (!this.planExists(name)) {
      return { success: false, error: `Plan '${name}' not found` };
    }

    // Parse YAML
    let def: PlanDefinition;
    try {
      def = parseYaml(yamlContent) as PlanDefinition;
    } catch (err) {
      return { success: false, error: `Invalid YAML: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Validate definition
    const validation = validatePlanDefinition(def);
    if (!validation.valid) {
      return { success: false, error: `Invalid plan: ${validation.errors.join('; ')}` };
    }

    // Calculate normalized content and digest
    const contentNormalized = normalizePlanForDigest(def);
    const digestSha256 = calculatePlanDigest(def);

    const now = new Date().toISOString();

    try {
      const stmt = this.db.prepare(`
        UPDATE plans SET
          schema_version = ?,
          content_yaml = ?,
          content_normalized = ?,
          digest_sha256 = ?,
          description = ?,
          updated_at = ?
        WHERE name = ?
      `);

      stmt.run(
        def.version,
        yamlContent,
        contentNormalized,
        digestSha256,
        def.description || null,
        now,
        name
      );

      return { success: true, plan: this.getPlan(name)! };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Delete a plan
   * @param force If true, also delete associated runs
   */
  deletePlan(name: string, force = false): { success: boolean; error?: string } {
    if (!this.planExists(name)) {
      return { success: false, error: `Plan '${name}' not found` };
    }

    try {
      if (force) {
        // Delete associated runs first
        const deleteRuns = this.db.prepare(`DELETE FROM runs WHERE plan_name = ?`);
        deleteRuns.run(name);
      }

      const stmt = this.db.prepare(`DELETE FROM plans WHERE name = ?`);
      stmt.run(name);

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Get plan definition (parsed YAML)
   */
  getPlanDefinition(name: string): PlanDefinition | null {
    const plan = this.getPlan(name);
    if (!plan) return null;

    try {
      return parseYaml(plan.content_yaml) as PlanDefinition;
    } catch {
      return null;
    }
  }

  /**
   * Export plan as YAML
   */
  exportPlanYaml(name: string): string | null {
    const plan = this.getPlan(name);
    if (!plan) return null;
    return plan.content_yaml;
  }

  /**
   * Import multiple plans from multi-document YAML
   */
  importPlans(
    yamlContent: string,
    source: 'import' | 'builtin' = 'import'
  ): { imported: string[]; errors: Array<{ name?: string; error: string }> } {
    const imported: string[] = [];
    const errors: Array<{ name?: string; error: string }> = [];

    // Split multi-document YAML
    const docs = yamlContent.split(/^---$/m).filter(s => s.trim());

    for (const doc of docs) {
      try {
        const def = parseYaml(doc) as PlanDefinition;
        const name = def.name;

        if (!name) {
          errors.push({ error: 'Plan missing name field' });
          continue;
        }

        const result = this.addPlan(name, doc.trim(), source);
        if (result.success) {
          imported.push(name);
        } else {
          errors.push({ name, error: result.error! });
        }
      } catch (err) {
        errors.push({ error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    return { imported, errors };
  }

  // ============================================================
  // Runs CRUD
  // ============================================================

  /**
   * Create a new run record (status = 'running')
   */
  createRun(params: {
    runId: string;
    planName: string;
    planDigest: string;
    connectorId: string;
    artifactPath: string;
  }): Run {
    const now = new Date().toISOString();

    const run: Run = {
      run_id: params.runId,
      plan_name: params.planName,
      plan_digest: params.planDigest,
      connector_id: params.connectorId,
      status: 'running',
      artifact_path: params.artifactPath,
      started_at: now,
      ended_at: null,
      created_at: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO runs (
        run_id, plan_name, plan_digest, connector_id, status,
        artifact_path, started_at, ended_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.run_id,
      run.plan_name,
      run.plan_digest,
      run.connector_id,
      run.status,
      run.artifact_path,
      run.started_at,
      run.ended_at,
      run.created_at
    );

    return run;
  }

  /**
   * Update run status and end time
   */
  completeRun(runId: string, status: RunStatus): void {
    const stmt = this.db.prepare(`
      UPDATE runs SET status = ?, ended_at = ? WHERE run_id = ?
    `);
    stmt.run(status, new Date().toISOString(), runId);
  }

  /**
   * Get run by ID
   */
  getRun(runId: string): Run | null {
    const stmt = this.db.prepare(`SELECT * FROM runs WHERE run_id = ?`);
    const result = stmt.get(runId) as Run | undefined;
    return result ?? null;
  }

  /**
   * Get latest run
   */
  getLatestRun(): Run | null {
    const stmt = this.db.prepare(`
      SELECT * FROM runs ORDER BY started_at DESC LIMIT 1
    `);
    const result = stmt.get() as Run | undefined;
    return result ?? null;
  }

  /**
   * List runs, optionally filtered by plan
   */
  listRuns(planName?: string, limit = 50): Run[] {
    if (planName) {
      const stmt = this.db.prepare(`
        SELECT * FROM runs WHERE plan_name = ? ORDER BY started_at DESC LIMIT ?
      `);
      return stmt.all(planName, limit) as Run[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM runs ORDER BY started_at DESC LIMIT ?
    `);
    return stmt.all(limit) as Run[];
  }

  /**
   * Delete a run
   */
  deleteRun(runId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM runs WHERE run_id = ?`);
    const result = stmt.run(runId);
    return result.changes > 0;
  }

  /**
   * Recover crashed runs (status = 'running' at startup)
   * Marks them as 'crashed'
   */
  recoverCrashedRuns(): number {
    const stmt = this.db.prepare(`
      UPDATE runs SET status = 'crashed', ended_at = ? WHERE status = 'running'
    `);
    const result = stmt.run(new Date().toISOString());
    return result.changes;
  }

  /**
   * Count runs by status
   */
  countRunsByStatus(): Record<RunStatus, number> {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM runs GROUP BY status
    `);
    const rows = stmt.all() as Array<{ status: RunStatus; count: number }>;

    const result: Record<RunStatus, number> = {
      running: 0,
      completed: 0,
      failed: 0,
      partial: 0,
      crashed: 0,
    };

    for (const row of rows) {
      result[row.status] = row.count;
    }

    return result;
  }
}
