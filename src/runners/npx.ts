/**
 * npx Runner implementation
 * Executes Node.js packages via npm's npx
 */

import type { Runner, RunnerStatus, PackageRef, MaterializedTransport } from './types.js';
import { detectRunner } from './types.js';

/**
 * npx Runner class
 */
export class NpxRunner implements Runner {
  readonly name = 'npx' as const;

  /**
   * Detect if npx is available on the system
   */
  async detect(): Promise<RunnerStatus> {
    return detectRunner(this.name);
  }

  /**
   * Materialize a package reference into npx command
   */
  materialize(pkg: PackageRef, env?: Record<string, string>): MaterializedTransport {
    const args = ['-y']; // Always use -y for non-interactive execution

    // Add package with optional version
    if (pkg.version) {
      args.push(`${pkg.package}@${pkg.version}`);
    } else {
      args.push(pkg.package);
    }

    return {
      command: 'npx',
      args,
      ...(env && Object.keys(env).length > 0 && { env }),
    };
  }
}

/** Singleton instance */
export const npxRunner = new NpxRunner();
