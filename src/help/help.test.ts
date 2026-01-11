/**
 * Tests for help system
 */

import { describe, it, expect } from 'vitest';
import { generateGuideHelp, generateInventoryHelp } from './index.js';

describe('generateGuideHelp', () => {
  it('includes three modes explanation', () => {
    const output = generateGuideHelp();
    expect(output).toContain('proofscan operates in three modes:');
    expect(output).toContain('CLI');
    expect(output).toContain('SHELL');
    expect(output).toContain('PROXY');
  });

  it('includes use-case categories', () => {
    const output = generateGuideHelp();
    expect(output).toContain('Observe & Inspect');
    expect(output).toContain('Run & Capture');
    expect(output).toContain('Explore Interactively');
    expect(output).toContain('Work with MCP Tools');
    expect(output).toContain('Manage Configuration & Data');
    expect(output).toContain('Proof & Ledger');
  });

  it('includes common commands', () => {
    const output = generateGuideHelp();
    expect(output).toContain('view');
    expect(output).toContain('tree');
    expect(output).toContain('scan');
    expect(output).toContain('shell');
    expect(output).toContain('config');
    expect(output).toContain('catalog');
  });

  it('does not include aliases', () => {
    const output = generateGuideHelp();
    // Should not have alias format like "(v)" or "view (v)"
    expect(output).not.toMatch(/view\s*\(v\)/);
    expect(output).not.toMatch(/tree\s*\(t\)/);
    expect(output).not.toMatch(/scan\s*\(s\)/);
  });

  it('includes navigation hints', () => {
    const output = generateGuideHelp();
    expect(output).toContain("See 'pfscan help <command>' for details.");
    expect(output).toContain("See 'pfscan help -a' for a complete list of commands.");
  });
});

describe('generateInventoryHelp', () => {
  it('includes Main commands section', () => {
    const output = generateInventoryHelp();
    expect(output).toContain('Main commands');
  });

  it('includes Ancillary commands section', () => {
    const output = generateInventoryHelp();
    expect(output).toContain('Ancillary commands');
  });

  it('includes aliases in parentheses', () => {
    const output = generateInventoryHelp();
    expect(output).toContain('view (v)');
    expect(output).toContain('tree (t)');
    expect(output).toContain('scan (s)');
    expect(output).toContain('config (c)');
    expect(output).toContain('archive (a)');
  });

  it('includes subcommands with indentation', () => {
    const output = generateInventoryHelp();
    // Check for subcommand entries
    expect(output).toContain('config path');
    expect(output).toContain('config init');
    expect(output).toContain('connectors ls');
    expect(output).toContain('secrets ls');
    expect(output).toContain('tool ls');
    expect(output).toContain('rpc ls');
  });

  it('includes navigation hint', () => {
    const output = generateInventoryHelp();
    expect(output).toContain("See 'pfscan help <command>' to read about a specific subcommand");
  });

  it('commands are in alphabetical order within sections', () => {
    const output = generateInventoryHelp();
    const lines = output.split('\n');

    // Find Main commands section and check order
    const mainIdx = lines.findIndex((l) => l.includes('Main commands'));
    const ancillaryIdx = lines.findIndex((l) => l.includes('Ancillary commands'));

    // Extract top-level command names between Main and Ancillary
    const mainCommands: string[] = [];
    for (let i = mainIdx + 1; i < ancillaryIdx; i++) {
      const line = lines[i];
      // Top-level commands start with 3 spaces followed by command name
      const match = line.match(/^\s{3}(\w+)/);
      if (match) {
        mainCommands.push(match[1]);
      }
    }

    // Check alphabetical order
    const sorted = [...mainCommands].sort();
    expect(mainCommands).toEqual(sorted);
  });
});
