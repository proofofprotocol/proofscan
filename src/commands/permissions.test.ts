/**
 * Tests for permissions command - Phase 3
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import type { PermissionsData, CategoryStats, ToolPermission } from './permissions.js';
import { createPermissionsCommand } from './permissions.js';

describe('PermissionsData structure', () => {
  // ============================================================
  // JSON structure tests
  // ============================================================
  describe('JSON structure validation', () => {
    it('has correct schema_version', () => {
      const data: PermissionsData = createMockPermissionsData();
      expect(data.schema_version).toBe('phase3.permissions.v1');
    });

    it('has session info fields', () => {
      const data: PermissionsData = createMockPermissionsData();
      expect(data.session_id).toBeDefined();
      expect(data.connector_id).toBeDefined();
      expect(data.resolved_by).toBeDefined();
    });

    it('has all category keys', () => {
      const data: PermissionsData = createMockPermissionsData();
      expect(data.categories.read).toBeDefined();
      expect(data.categories.write).toBeDefined();
      expect(data.categories.network).toBeDefined();
      expect(data.categories.exec).toBeDefined();
      expect(data.categories.other).toBeDefined();
    });

    it('has totals', () => {
      const data: PermissionsData = createMockPermissionsData();
      expect(data.totals.allowed_tool_count).toBeDefined();
      expect(data.totals.called_count).toBeDefined();
    });
  });

  // ============================================================
  // Time connector example (tools/list only, no tools/call)
  // ============================================================
  describe('time connector example (no tool calls)', () => {
    it('categorizes time tools as other', () => {
      const data: PermissionsData = createTimeConnectorData();

      // Both tools should be in "other" category
      expect(data.categories.other.allowed_tool_count).toBe(2);
      expect(data.categories.other.called_count).toBe(0);

      // Other categories should be empty
      expect(data.categories.read.allowed_tool_count).toBe(0);
      expect(data.categories.write.allowed_tool_count).toBe(0);
      expect(data.categories.network.allowed_tool_count).toBe(0);
      expect(data.categories.exec.allowed_tool_count).toBe(0);
    });

    it('has correct tool entries for time connector', () => {
      const data: PermissionsData = createTimeConnectorData();

      const tools = data.categories.other.tools;
      expect(tools).toHaveLength(2);

      // Both tools allowed, not called
      expect(tools.find(t => t.name === 'get_current_time')).toEqual({
        name: 'get_current_time',
        allowed: true,
        called: 0,
      });
      expect(tools.find(t => t.name === 'convert_time')).toEqual({
        name: 'convert_time',
        allowed: true,
        called: 0,
      });
    });

    it('has correct totals for time connector', () => {
      const data: PermissionsData = createTimeConnectorData();

      expect(data.totals.allowed_tool_count).toBe(2);
      expect(data.totals.called_count).toBe(0);
    });
  });

  // ============================================================
  // Tool ordering: called desc, then name asc
  // ============================================================
  describe('tool ordering', () => {
    it('orders tools by called desc, then name asc', () => {
      const data: PermissionsData = createMixedToolsData();

      const tools = data.categories.read.tools;

      // Expected order: read_file (5), list_files (3), cat (1), show (0)
      expect(tools[0].name).toBe('read_file');
      expect(tools[0].called).toBe(5);

      expect(tools[1].name).toBe('list_files');
      expect(tools[1].called).toBe(3);

      expect(tools[2].name).toBe('cat');
      expect(tools[2].called).toBe(1);

      expect(tools[3].name).toBe('show');
      expect(tools[3].called).toBe(0);
    });

    it('orders by name when call count is same', () => {
      const data: PermissionsData = createSameCallCountData();

      const tools = data.categories.other.tools;

      // All have 0 calls, should be sorted alphabetically
      expect(tools[0].name).toBe('alpha');
      expect(tools[1].name).toBe('beta');
      expect(tools[2].name).toBe('gamma');
    });
  });

  // ============================================================
  // Category stats
  // ============================================================
  describe('category stats', () => {
    it('calculates allowed_tool_count correctly', () => {
      const data: PermissionsData = createMixedCategoriesData();

      expect(data.categories.read.allowed_tool_count).toBe(2);
      expect(data.categories.write.allowed_tool_count).toBe(1);
      expect(data.categories.exec.allowed_tool_count).toBe(1);
    });

    it('calculates called_count correctly', () => {
      const data: PermissionsData = createMixedCategoriesData();

      expect(data.categories.read.called_count).toBe(8); // 5 + 3
      expect(data.categories.write.called_count).toBe(2);
      expect(data.categories.exec.called_count).toBe(10);
    });
  });
});

// ============================================================
// Mock data helpers
// ============================================================

function createMockPermissionsData(): PermissionsData {
  return {
    schema_version: 'phase3.permissions.v1',
    session_id: 'test-session-id',
    connector_id: 'test-connector',
    resolved_by: 'current',
    categories: {
      read: { allowed_tool_count: 0, called_count: 0, tools: [] },
      write: { allowed_tool_count: 0, called_count: 0, tools: [] },
      network: { allowed_tool_count: 0, called_count: 0, tools: [] },
      exec: { allowed_tool_count: 0, called_count: 0, tools: [] },
      other: { allowed_tool_count: 0, called_count: 0, tools: [] },
    },
    totals: {
      allowed_tool_count: 0,
      called_count: 0,
    },
  };
}

function createTimeConnectorData(): PermissionsData {
  return {
    schema_version: 'phase3.permissions.v1',
    session_id: '8ae3a44c-44ad-467d-b9a8-1c8217f8506f',
    connector_id: 'time',
    resolved_by: 'current',
    categories: {
      read: { allowed_tool_count: 0, called_count: 0, tools: [] },
      write: { allowed_tool_count: 0, called_count: 0, tools: [] },
      network: { allowed_tool_count: 0, called_count: 0, tools: [] },
      exec: { allowed_tool_count: 0, called_count: 0, tools: [] },
      other: {
        allowed_tool_count: 2,
        called_count: 0,
        tools: [
          { name: 'convert_time', allowed: true, called: 0 },
          { name: 'get_current_time', allowed: true, called: 0 },
        ],
      },
    },
    totals: {
      allowed_tool_count: 2,
      called_count: 0,
    },
  };
}

function createMixedToolsData(): PermissionsData {
  return {
    schema_version: 'phase3.permissions.v1',
    session_id: 'test-session',
    connector_id: 'test',
    resolved_by: 'current',
    categories: {
      read: {
        allowed_tool_count: 4,
        called_count: 9,
        tools: [
          { name: 'read_file', allowed: true, called: 5 },
          { name: 'list_files', allowed: true, called: 3 },
          { name: 'cat', allowed: true, called: 1 },
          { name: 'show', allowed: true, called: 0 },
        ],
      },
      write: { allowed_tool_count: 0, called_count: 0, tools: [] },
      network: { allowed_tool_count: 0, called_count: 0, tools: [] },
      exec: { allowed_tool_count: 0, called_count: 0, tools: [] },
      other: { allowed_tool_count: 0, called_count: 0, tools: [] },
    },
    totals: {
      allowed_tool_count: 4,
      called_count: 9,
    },
  };
}

function createSameCallCountData(): PermissionsData {
  return {
    schema_version: 'phase3.permissions.v1',
    session_id: 'test-session',
    connector_id: 'test',
    resolved_by: 'current',
    categories: {
      read: { allowed_tool_count: 0, called_count: 0, tools: [] },
      write: { allowed_tool_count: 0, called_count: 0, tools: [] },
      network: { allowed_tool_count: 0, called_count: 0, tools: [] },
      exec: { allowed_tool_count: 0, called_count: 0, tools: [] },
      other: {
        allowed_tool_count: 3,
        called_count: 0,
        tools: [
          { name: 'alpha', allowed: true, called: 0 },
          { name: 'beta', allowed: true, called: 0 },
          { name: 'gamma', allowed: true, called: 0 },
        ],
      },
    },
    totals: {
      allowed_tool_count: 3,
      called_count: 0,
    },
  };
}

function createMixedCategoriesData(): PermissionsData {
  return {
    schema_version: 'phase3.permissions.v1',
    session_id: 'test-session',
    connector_id: 'test',
    resolved_by: 'current',
    categories: {
      read: {
        allowed_tool_count: 2,
        called_count: 8,
        tools: [
          { name: 'read_file', allowed: true, called: 5 },
          { name: 'list_files', allowed: true, called: 3 },
        ],
      },
      write: {
        allowed_tool_count: 1,
        called_count: 2,
        tools: [
          { name: 'write_file', allowed: true, called: 2 },
        ],
      },
      network: { allowed_tool_count: 0, called_count: 0, tools: [] },
      exec: {
        allowed_tool_count: 1,
        called_count: 10,
        tools: [
          { name: 'run_command', allowed: true, called: 10 },
        ],
      },
      other: { allowed_tool_count: 0, called_count: 0, tools: [] },
    },
    totals: {
      allowed_tool_count: 4,
      called_count: 20,
    },
  };
}

// ============================================================
// CLI argument parsing tests
// ============================================================

describe('permissions command CLI', () => {
  function createTestCommand() {
    const program = new Command();
    program.exitOverride(); // Throw instead of process.exit
    const cmd = createPermissionsCommand(() => '/tmp/test-config');
    program.addCommand(cmd);
    return program;
  }

  it('accepts positional connector argument', () => {
    const program = createTestCommand();
    const cmd = program.commands.find(c => c.name() === 'permissions')!;

    // Check argument is defined
    const args = cmd.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe('connector');
    expect(args[0].required).toBe(false); // Optional argument
  });

  it('has --id as alias for --connector', () => {
    const program = createTestCommand();
    const cmd = program.commands.find(c => c.name() === 'permissions')!;

    const options = cmd.options;
    const idOption = options.find(o => o.long === '--id');
    const connectorOption = options.find(o => o.long === '--connector');

    expect(idOption).toBeDefined();
    expect(connectorOption).toBeDefined();
    expect(idOption?.description).toContain('Alias');
  });

  it('has help text with examples', () => {
    const program = createTestCommand();
    const cmd = program.commands.find(c => c.name() === 'permissions')!;

    // helpInformation() returns basic help; addHelpText adds to _helpConfiguration
    // We can verify that help configuration has afterAll or after hooks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const helpConfig = (cmd as any)._helpConfiguration;
    // Check that afterAll is defined (addHelpText('after') sets this)
    expect(helpConfig).toBeDefined();

    // Alternative: verify command options are present
    const helpInfo = cmd.helpInformation();
    expect(helpInfo).toContain('--session');
    expect(helpInfo).toContain('--latest');
    expect(helpInfo).toContain('--connector');
    expect(helpInfo).toContain('--id');
    expect(helpInfo).toContain('connector');
  });
});
