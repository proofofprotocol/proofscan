/**
 * Runner types for package execution (npx, uvx)
 */

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
