/**
 * Tests for PlansStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PlansStore } from './store.js';

describe('PlansStore', () => {
  let tempDir: string;
  let store: PlansStore;

  const validPlanYaml = `version: 1
name: test-plan
description: A test plan
steps:
  - mcp: initialize
  - mcp: tools/list
  - when: capabilities.resources
    mcp: resources/list
`;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'plans-store-test-'));
    store = new PlansStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('addPlan', () => {
    it('should add a valid plan', () => {
      const result = store.addPlan('test-plan', validPlanYaml, 'manual');

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.name).toBe('test-plan');
      expect(result.plan?.source).toBe('manual');
      expect(result.plan?.digest_sha256).toBeDefined();
    });

    it('should reject invalid plan name', () => {
      const result = store.addPlan('Invalid Name!', validPlanYaml, 'manual');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid plan name');
    });

    it('should reject duplicate plan', () => {
      store.addPlan('test-plan', validPlanYaml, 'manual');
      const result = store.addPlan('test-plan', validPlanYaml, 'manual');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject invalid YAML', () => {
      const result = store.addPlan('test-plan', 'not: [valid: yaml', 'manual');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid YAML');
    });

    it('should reject plan without initialize step', () => {
      const invalidPlan = `version: 1
name: bad-plan
steps:
  - mcp: tools/list
`;
      const result = store.addPlan('bad-plan', invalidPlan, 'manual');

      expect(result.success).toBe(false);
      expect(result.error).toContain('initialize');
    });
  });

  describe('getPlan', () => {
    it('should retrieve an existing plan', () => {
      store.addPlan('test-plan', validPlanYaml, 'manual');

      const plan = store.getPlan('test-plan');

      expect(plan).toBeDefined();
      expect(plan?.name).toBe('test-plan');
      expect(plan?.description).toBe('A test plan');
    });

    it('should return null for non-existent plan', () => {
      const plan = store.getPlan('non-existent');

      expect(plan).toBeNull();
    });
  });

  describe('listPlans', () => {
    it('should list all plans', () => {
      store.addPlan('plan-a', validPlanYaml.replace('test-plan', 'plan-a'), 'manual');
      store.addPlan('plan-b', validPlanYaml.replace('test-plan', 'plan-b'), 'manual');

      const plans = store.listPlans();

      expect(plans.length).toBe(2);
    });

    it('should return empty array when no plans', () => {
      const plans = store.listPlans();

      expect(plans).toEqual([]);
    });
  });

  describe('deletePlan', () => {
    it('should delete an existing plan', () => {
      store.addPlan('test-plan', validPlanYaml, 'manual');

      const result = store.deletePlan('test-plan');

      expect(result.success).toBe(true);
      expect(store.getPlan('test-plan')).toBeNull();
    });

    it('should fail for non-existent plan', () => {
      const result = store.deletePlan('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('updatePlan', () => {
    it('should update an existing plan', () => {
      store.addPlan('test-plan', validPlanYaml, 'manual');

      const updatedYaml = validPlanYaml.replace('A test plan', 'An updated plan');
      const result = store.updatePlan('test-plan', updatedYaml);

      expect(result.success).toBe(true);
      expect(result.plan?.description).toBe('An updated plan');
    });

    it('should fail for non-existent plan', () => {
      const result = store.updatePlan('non-existent', validPlanYaml);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('runs', () => {
    beforeEach(() => {
      store.addPlan('test-plan', validPlanYaml, 'manual');
    });

    it('should create a run', () => {
      const run = store.createRun({
        runId: 'run-001',
        planName: 'test-plan',
        planDigest: 'abc123',
        connectorId: 'test-connector',
        artifactPath: 'artifacts/run-001',
      });

      expect(run.run_id).toBe('run-001');
      expect(run.status).toBe('running');
    });

    it('should complete a run', () => {
      store.createRun({
        runId: 'run-001',
        planName: 'test-plan',
        planDigest: 'abc123',
        connectorId: 'test-connector',
        artifactPath: 'artifacts/run-001',
      });

      store.completeRun('run-001', 'completed');

      const run = store.getRun('run-001');
      expect(run?.status).toBe('completed');
      expect(run?.ended_at).toBeDefined();
    });

    it('should get latest run', () => {
      store.createRun({
        runId: 'run-001',
        planName: 'test-plan',
        planDigest: 'abc123',
        connectorId: 'test-connector',
        artifactPath: 'artifacts/run-001',
      });

      const latest = store.getLatestRun();
      expect(latest?.run_id).toBe('run-001');
    });

    it('should list runs by plan', () => {
      store.createRun({
        runId: 'run-001',
        planName: 'test-plan',
        planDigest: 'abc123',
        connectorId: 'test-connector',
        artifactPath: 'artifacts/run-001',
      });

      const runs = store.listRuns('test-plan');
      expect(runs.length).toBe(1);
    });

    it('should recover crashed runs', () => {
      store.createRun({
        runId: 'run-001',
        planName: 'test-plan',
        planDigest: 'abc123',
        connectorId: 'test-connector',
        artifactPath: 'artifacts/run-001',
      });

      const recovered = store.recoverCrashedRuns();
      expect(recovered).toBe(1);

      const run = store.getRun('run-001');
      expect(run?.status).toBe('crashed');
    });
  });

  describe('importPlans', () => {
    it('should import single plan', () => {
      const result = store.importPlans(validPlanYaml, 'import');

      expect(result.imported).toContain('test-plan');
      expect(result.errors.length).toBe(0);
    });

    it('should import multiple plans from multi-doc YAML', () => {
      const multiDoc = `${validPlanYaml}
---
version: 1
name: plan-two
steps:
  - mcp: initialize
`;

      const result = store.importPlans(multiDoc, 'import');

      expect(result.imported.length).toBe(2);
      expect(result.imported).toContain('test-plan');
      expect(result.imported).toContain('plan-two');
    });

    it('should handle partial import errors', () => {
      store.addPlan('test-plan', validPlanYaml, 'manual'); // Already exists

      const multiDoc = `${validPlanYaml}
---
version: 1
name: plan-two
steps:
  - mcp: initialize
`;

      const result = store.importPlans(multiDoc, 'import');

      expect(result.imported).toContain('plan-two');
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].name).toBe('test-plan');
    });
  });
});
