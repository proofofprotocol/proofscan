/**
 * uvx Runner implementation
 * Executes Python packages via uv's uvx command
 */

import type { Runner, RunnerStatus, PackageRef, MaterializedTransport } from './types.js';
import { detectRunner } from './types.js';

/**
 * uvx Runner class
 */
export class UvxRunner implements Runner {
  readonly name = 'uvx' as const;

  /**
   * Detect if uvx is available on the system
   */
  async detect(): Promise<RunnerStatus> {
    return detectRunner(this.name);
  }

  /**
   * Materialize a package reference into uvx command
   */
  materialize(pkg: PackageRef, env?: Record<string, string>): MaterializedTransport {
    const args: string[] = [];

    // Add package with optional version (Python style: package==version)
    if (pkg.version) {
      args.push(`${pkg.package}==${pkg.version}`);
    } else {
      args.push(pkg.package);
    }

    return {
      command: 'uvx',
      args,
      ...(env && Object.keys(env).length > 0 && { env }),
    };
  }
}

/** Singleton instance */
export const uvxRunner = new UvxRunner();
