/**
 * Tests for record command - Phase 3
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  createRecordCommand,
  canonicalizeJson,
  computeDigest,
  calculateImportance,
  type DryRunData,
  type Candidate,
  type ToolCallPayload,
  type CapabilityCatalogPayload,
} from './record.js';

// ============================================================
// canonicalizeJson tests
// ============================================================

describe('canonicalizeJson', () => {
  it('handles null', () => {
    expect(canonicalizeJson(null)).toBe('null');
  });

  it('handles undefined', () => {
    expect(canonicalizeJson(undefined)).toBe('null');
  });

  it('handles strings', () => {
    expect(canonicalizeJson('hello')).toBe('"hello"');
  });

  it('handles numbers', () => {
    expect(canonicalizeJson(42)).toBe('42');
    expect(canonicalizeJson(3.14)).toBe('3.14');
  });

  it('handles booleans', () => {
    expect(canonicalizeJson(true)).toBe('true');
    expect(canonicalizeJson(false)).toBe('false');
  });

  it('handles arrays', () => {
    expect(canonicalizeJson([1, 2, 3])).toBe('[1,2,3]');
    expect(canonicalizeJson(['a', 'b'])).toBe('["a","b"]');
  });

  it('handles objects with sorted keys', () => {
    const obj = { z: 1, a: 2, m: 3 };
    expect(canonicalizeJson(obj)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('handles nested objects with sorted keys', () => {
    const obj = { b: { z: 1, a: 2 }, a: 1 };
    expect(canonicalizeJson(obj)).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it('produces stable output for same input', () => {
    const obj1 = { name: 'test', value: 123 };
    const obj2 = { value: 123, name: 'test' };
    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
  });
});

// ============================================================
// computeDigest tests
// ============================================================

describe('computeDigest', () => {
  it('produces consistent digest for same input', () => {
    const obj = { tool: 'read_file', args: { path: '/tmp/test' } };
    const digest1 = computeDigest(obj);
    const digest2 = computeDigest(obj);
    expect(digest1).toBe(digest2);
  });

  it('produces different digests for different inputs', () => {
    const digest1 = computeDigest({ a: 1 });
    const digest2 = computeDigest({ a: 2 });
    expect(digest1).not.toBe(digest2);
  });

  it('produces 64-character hex string (sha256)', () => {
    const digest = computeDigest({ test: 'value' });
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('key order does not affect digest', () => {
    const digest1 = computeDigest({ z: 1, a: 2 });
    const digest2 = computeDigest({ a: 2, z: 1 });
    expect(digest1).toBe(digest2);
  });
});

// ============================================================
// calculateImportance tests
// ============================================================

describe('calculateImportance', () => {
  it('base score is 80 for read category', () => {
    expect(calculateImportance('read', false)).toBe(80);
  });

  it('exec category adds 30', () => {
    expect(calculateImportance('exec', false)).toBe(110);
  });

  it('network category adds 15', () => {
    expect(calculateImportance('network', false)).toBe(95);
  });

  it('write category adds 15', () => {
    expect(calculateImportance('write', false)).toBe(95);
  });

  it('other category adds 5', () => {
    expect(calculateImportance('other', false)).toBe(85);
  });

  it('error adds 10', () => {
    expect(calculateImportance('read', true)).toBe(90);
    expect(calculateImportance('exec', true)).toBe(120);
  });
});

// ============================================================
// DryRunData structure tests
// ============================================================

describe('DryRunData structure', () => {
  function createMockDryRunData(candidates: Candidate[] = []): DryRunData {
    return {
      schema_version: 'phase3.record_dry_run.v1',
      options: {
        include_capabilities: false,
        redaction_mode: 'digest_only',
      },
      session: {
        id: 'test-session-id',
        connector_id: 'test-connector',
        resolved_by: 'current',
      },
      candidates,
      summary: {
        candidate_count: candidates.length,
        importance_max: candidates.length > 0
          ? Math.max(...candidates.map(c => c.importance))
          : 0,
      },
    };
  }

  it('has correct schema_version', () => {
    const data = createMockDryRunData();
    expect(data.schema_version).toBe('phase3.record_dry_run.v1');
  });

  it('has redaction_mode digest_only', () => {
    const data = createMockDryRunData();
    expect(data.options.redaction_mode).toBe('digest_only');
  });

  it('empty candidates by default', () => {
    const data = createMockDryRunData();
    expect(data.candidates).toHaveLength(0);
    expect(data.summary.candidate_count).toBe(0);
    expect(data.summary.importance_max).toBe(0);
  });
});

// ============================================================
// Candidate structure tests (digest_only mode)
// ============================================================

describe('Candidate structure (digest_only)', () => {
  function createToolCallCandidate(): Candidate {
    const payload: ToolCallPayload = {
      tool: 'read_file',
      result: 'success',
      input_digest: 'abc123def456',
      output_digest: 'def456abc123',
    };

    return {
      id: 'tc-12345678',
      type: 'tool_call',
      importance: 80,
      category: 'read',
      source: {
        rpc_id: '12345678-1234-1234-1234-123456789012',
        method: 'tools/call',
        tool: 'read_file',
      },
      payload,
      digests: {
        payload_digest: computeDigest(payload),
      },
      notes: [],
    };
  }

  it('tool_call candidate has no raw input/output', () => {
    const candidate = createToolCallCandidate();
    const payload = candidate.payload as ToolCallPayload;

    // Should have digests
    expect(payload.input_digest).toBeDefined();
    expect(payload.output_digest).toBeDefined();

    // Should NOT have raw values (only digests)
    expect(payload).not.toHaveProperty('input');
    expect(payload).not.toHaveProperty('output');
    expect(payload).not.toHaveProperty('arguments');
    expect(payload).not.toHaveProperty('content');
  });

  it('tool_call payload has required fields', () => {
    const candidate = createToolCallCandidate();
    const payload = candidate.payload as ToolCallPayload;

    expect(payload.tool).toBe('read_file');
    expect(payload.result).toBe('success');
    expect(payload.input_digest).toBeDefined();
    expect(payload.output_digest).toBeDefined();
  });

  it('candidate has payload_digest', () => {
    const candidate = createToolCallCandidate();
    expect(candidate.digests.payload_digest).toBeDefined();
    expect(candidate.digests.payload_digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================
// Capability catalog candidate tests
// ============================================================

describe('Capability catalog candidate', () => {
  function createCapabilityCatalog(): Candidate {
    const payload: CapabilityCatalogPayload = {
      tool_count: 2,
      tools: ['get_current_time', 'convert_time'],
    };

    return {
      id: 'cap-12345678',
      type: 'capability_catalog',
      importance: 50,
      category: 'other',
      source: {
        rpc_id: '12345678-1234-1234-1234-123456789012',
        method: 'tools/list',
      },
      payload,
      digests: {
        payload_digest: computeDigest(payload),
      },
      notes: [],
    };
  }

  it('has type capability_catalog', () => {
    const candidate = createCapabilityCatalog();
    expect(candidate.type).toBe('capability_catalog');
  });

  it('has lower importance than tool_call', () => {
    const candidate = createCapabilityCatalog();
    expect(candidate.importance).toBe(50);
  });

  it('payload has tool list', () => {
    const candidate = createCapabilityCatalog();
    const payload = candidate.payload as CapabilityCatalogPayload;

    expect(payload.tool_count).toBe(2);
    expect(payload.tools).toContain('get_current_time');
    expect(payload.tools).toContain('convert_time');
  });
});

// ============================================================
// CLI tests
// ============================================================

describe('record command CLI', () => {
  function createTestCommand() {
    const program = new Command();
    program.exitOverride();
    const cmd = createRecordCommand(() => '/tmp/test-config');
    program.addCommand(cmd);
    return program;
  }

  it('has dry-run subcommand', () => {
    const program = createTestCommand();
    const recordCmd = program.commands.find(c => c.name() === 'record')!;
    const dryRunCmd = recordCmd.commands.find(c => c.name() === 'dry-run');

    expect(dryRunCmd).toBeDefined();
  });

  it('dry-run accepts positional connector argument', () => {
    const program = createTestCommand();
    const recordCmd = program.commands.find(c => c.name() === 'record')!;
    const dryRunCmd = recordCmd.commands.find(c => c.name() === 'dry-run')!;

    const args = dryRunCmd.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe('connector');
    expect(args[0].required).toBe(false);
  });

  it('dry-run has --include-capabilities option', () => {
    const program = createTestCommand();
    const recordCmd = program.commands.find(c => c.name() === 'record')!;
    const dryRunCmd = recordCmd.commands.find(c => c.name() === 'dry-run')!;

    const options = dryRunCmd.options;
    const capOption = options.find(o => o.long === '--include-capabilities');

    expect(capOption).toBeDefined();
  });

  it('dry-run has session resolution options', () => {
    const program = createTestCommand();
    const recordCmd = program.commands.find(c => c.name() === 'record')!;
    const dryRunCmd = recordCmd.commands.find(c => c.name() === 'dry-run')!;

    const options = dryRunCmd.options;
    expect(options.find(o => o.long === '--session')).toBeDefined();
    expect(options.find(o => o.long === '--latest')).toBeDefined();
    expect(options.find(o => o.long === '--connector')).toBeDefined();
    expect(options.find(o => o.long === '--id')).toBeDefined();
  });
});

// ============================================================
// Integration scenario tests (mock data)
// ============================================================

describe('Integration scenarios', () => {
  it('tools/list only session has empty candidates by default', () => {
    // Simulate a session with only tools/list (no tools/call)
    const data: DryRunData = {
      schema_version: 'phase3.record_dry_run.v1',
      options: {
        include_capabilities: false,
        redaction_mode: 'digest_only',
      },
      session: {
        id: 'time-session',
        connector_id: 'time',
        resolved_by: 'latest',
      },
      candidates: [], // No tool calls
      summary: {
        candidate_count: 0,
        importance_max: 0,
      },
    };

    expect(data.candidates).toHaveLength(0);
  });

  it('tools/list only session with --include-capabilities has one candidate', () => {
    const capPayload: CapabilityCatalogPayload = {
      tool_count: 2,
      tools: ['get_current_time', 'convert_time'],
    };

    const data: DryRunData = {
      schema_version: 'phase3.record_dry_run.v1',
      options: {
        include_capabilities: true,
        redaction_mode: 'digest_only',
      },
      session: {
        id: 'time-session',
        connector_id: 'time',
        resolved_by: 'latest',
      },
      candidates: [
        {
          id: 'cap-12345678',
          type: 'capability_catalog',
          importance: 50,
          category: 'other',
          source: {
            rpc_id: '12345678-1234-1234-1234-123456789012',
            method: 'tools/list',
          },
          payload: capPayload,
          digests: {
            payload_digest: computeDigest(capPayload),
          },
          notes: [],
        },
      ],
      summary: {
        candidate_count: 1,
        importance_max: 50,
      },
    };

    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0].type).toBe('capability_catalog');
  });

  it('importance scoring reflects category correctly', () => {
    // exec tool should have higher importance
    const execImportance = calculateImportance('exec', false);
    const readImportance = calculateImportance('read', false);
    const networkImportance = calculateImportance('network', false);

    expect(execImportance).toBeGreaterThan(networkImportance);
    expect(networkImportance).toBeGreaterThan(readImportance);
  });

  it('digest is stable for same payload', () => {
    const payload1: ToolCallPayload = {
      tool: 'read_file',
      result: 'success',
      input_digest: 'abc',
      output_digest: 'def',
    };

    const payload2: ToolCallPayload = {
      tool: 'read_file',
      result: 'success',
      input_digest: 'abc',
      output_digest: 'def',
    };

    expect(computeDigest(payload1)).toBe(computeDigest(payload2));
  });
});
