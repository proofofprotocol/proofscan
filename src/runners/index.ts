/**
 * Runner subsystem - package execution abstraction
 *
 * Provides a unified interface for executing packages via npx or uvx.
 */

import type { Runner, RunnerName, RunnerStatus, PackageRef, MaterializedTransport } from './types.js';
import { npxRunner } from './npx.js';
import { uvxRunner } from './uvx.js';

// Re-export types
export type { Runner, RunnerName, RunnerStatus, PackageRef, MaterializedTransport };

/**
 * All available runners in priority order (npx first, then uvx)
 */
const RUNNERS: Runner[] = [npxRunner, uvxRunner];

/**
 * Get a specific runner by name
 * @throws Error if runner name is unknown
 */
export function getRunner(name: RunnerName): Runner {
  switch (name) {
    case 'npx':
      return npxRunner;
    case 'uvx':
      return uvxRunner;
    default:
      throw new Error(`Unknown runner: ${name}`);
  }
}

/**
 * List all available runner names
 */
export function listRunnerNames(): RunnerName[] {
  return ['npx', 'uvx'];
}

/**
 * Detect all runners and return their status
 * Results are in priority order (npx first)
 */
export async function detectAll(): Promise<RunnerStatus[]> {
  return Promise.all(RUNNERS.map((r) => r.detect()));
}

/**
 * Find the first available runner (priority: npx > uvx)
 * @returns Runner if found, null if none available
 */
export async function findAvailableRunner(): Promise<Runner | null> {
  for (const runner of RUNNERS) {
    const status = await runner.detect();
    if (status.available) {
      return runner;
    }
  }
  return null;
}

/**
 * Parse catalog transport into PackageRef
 *
 * Handles various formats from registry:
 * - { command: "npx", args: ["-y", "@pkg/name"] }
 * - { command: "npx", args: ["-y", "@pkg/name@1.0.0"] }
 * - { command: "uvx", args: ["mcp-server"] }
 * - { command: "uvx", args: ["mcp-server==1.0.0"] }
 *
 * @returns PackageRef or null if cannot be parsed as a runner package
 */
export function parsePackageRef(transport: {
  command?: string;
  args?: string[];
}): PackageRef | null {
  if (!transport.command || !transport.args || transport.args.length === 0) {
    return null;
  }

  const cmd = transport.command.toLowerCase();
  const args = transport.args;

  // Handle npx format: npx [-y] [--yes] <package[@version]>
  if (cmd === 'npx') {
    // Find package name (skip flags like -y, --yes, -p, --package)
    const pkgArg = args.find((a) => !a.startsWith('-'));
    if (pkgArg) {
      return parseNpmPackageRef(pkgArg);
    }
  }

  // Handle uvx format: uvx <package[==version]>
  if (cmd === 'uvx' || cmd === 'uv') {
    const pkgArg = args.find((a) => !a.startsWith('-'));
    if (pkgArg) {
      return parsePythonPackageRef(pkgArg);
    }
  }

  return null;
}

/**
 * Parse npm-style package reference (package@version)
 */
function parseNpmPackageRef(pkgArg: string): PackageRef {
  // Handle scoped packages: @scope/name@version
  // The version @ is the last @ after the scope
  const lastAtIndex = pkgArg.lastIndexOf('@');

  // If @ is at position 0, it's a scope, not a version separator
  // If @ is after position 0 and after the first segment, it's a version
  if (lastAtIndex > 0) {
    const beforeAt = pkgArg.slice(0, lastAtIndex);
    const afterAt = pkgArg.slice(lastAtIndex + 1);

    // Make sure we're not splitting a scope (@scope/name)
    // Check if beforeAt contains a / (indicating it's a full package name)
    if (beforeAt.includes('/') || !beforeAt.startsWith('@')) {
      return {
        package: beforeAt,
        version: afterAt,
      };
    }
  }

  return { package: pkgArg };
}

/**
 * Parse Python-style package reference (package==version)
 */
function parsePythonPackageRef(pkgArg: string): PackageRef {
  const eqIndex = pkgArg.indexOf('==');
  if (eqIndex > 0) {
    return {
      package: pkgArg.slice(0, eqIndex),
      version: pkgArg.slice(eqIndex + 2),
    };
  }
  return { package: pkgArg };
}

// Re-export individual runners for direct access
export { npxRunner, uvxRunner };
