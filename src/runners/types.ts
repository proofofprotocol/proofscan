/**
 * Runner types for package execution (npx, uvx)
 */

import { execSync } from 'child_process';

/**
 * Runner names supported by proofscan
 */
export type RunnerName = 'npx' | 'uvx';

/**
 * Runner status from detection
 */
export interface RunnerStatus {
  /** Runner name identifier */
  name: RunnerName;
  /** Whether the runner is available on the system */
  available: boolean;
  /** Version string if available */
  version?: string;
  /** Path to the runner executable */
  path?: string;
  /** Error message if detection failed */
  error?: string;
}

/**
 * Materialized stdio transport config from runner
 */
export interface MaterializedTransport {
  /** Command to execute */
  command: string;
  /** Command arguments */
  args: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
}

/**
 * Package reference for stdio server
 * Parsed from catalog transport.command/args
 */
export interface PackageRef {
  /** Package name (e.g., "@modelcontextprotocol/server-filesystem") */
  package: string;
  /** Optional version specifier (e.g., "1.0.0" or "latest") */
  version?: string;
}

/**
 * Runner interface - abstracts npx/uvx execution
 */
export interface Runner {
  /** Runner name identifier */
  readonly name: RunnerName;

  /**
   * Detect if runner is available on the system
   * Uses `which` (Unix) or `where` (Windows) to check
   * @returns Runner status with availability info
   */
  detect(): Promise<RunnerStatus>;

  /**
   * Materialize a package reference into executable transport config
   * @param pkg - Package reference from catalog
   * @param env - Optional environment variables to include
   * @returns Transport config for StdioTransport
   */
  materialize(pkg: PackageRef, env?: Record<string, string>): MaterializedTransport;
}

/**
 * Common detection logic for runners
 * @param runnerName - Name of the runner to detect
 * @returns RunnerStatus with availability info
 */
export async function detectRunner(runnerName: RunnerName): Promise<RunnerStatus> {
  try {
    // Use 'which' on Unix, 'where' on Windows
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const pathOutput = execSync(`${whichCmd} ${runnerName}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Take first line (Windows 'where' may return multiple paths)
    const path = pathOutput.split('\n')[0].trim();

    // Get version
    let version: string | undefined;
    try {
      version = execSync(`${runnerName} --version`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Version detection failed, but runner exists
    }

    return {
      name: runnerName,
      available: true,
      version,
      path,
    };
  } catch (error) {
    return {
      name: runnerName,
      available: false,
      error: error instanceof Error ? error.message : `${runnerName} not found in PATH`,
    };
  }
}

/**
 * Regex pattern for valid environment variable names
 * Only alphanumeric and underscore, must start with letter or underscore
 */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Maximum length for environment variable values (security limit)
 */
const MAX_ENV_VALUE_LENGTH = 32768;

/**
 * Validate and sanitize environment variables from catalog
 * @param env - Raw environment variables from catalog
 * @returns Sanitized environment variables (invalid entries removed)
 */
export function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env || typeof env !== 'object') {
    return undefined;
  }

  const sanitized: Record<string, string> = {};
  let hasValidEntries = false;

  for (const [key, value] of Object.entries(env)) {
    // Validate key format
    if (!ENV_KEY_PATTERN.test(key)) {
      continue; // Skip invalid key
    }

    // Validate value type and length
    if (typeof value !== 'string') {
      continue; // Skip non-string value
    }

    if (value.length > MAX_ENV_VALUE_LENGTH) {
      continue; // Skip too-long value
    }

    sanitized[key] = value;
    hasValidEntries = true;
  }

  return hasValidEntries ? sanitized : undefined;
}
