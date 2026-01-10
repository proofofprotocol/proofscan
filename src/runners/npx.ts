/**
 * npx Runner implementation
 * Executes Node.js packages via npm's npx
 */

import { execSync } from 'child_process';
import type { Runner, RunnerStatus, PackageRef, MaterializedTransport } from './types.js';

/**
 * npx Runner class
 */
export class NpxRunner implements Runner {
  readonly name = 'npx' as const;

  /**
   * Detect if npx is available on the system
   */
  async detect(): Promise<RunnerStatus> {
    try {
      // Use 'which' on Unix, 'where' on Windows
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const pathOutput = execSync(`${whichCmd} npx`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // Take first line (Windows 'where' may return multiple paths)
      const path = pathOutput.split('\n')[0].trim();

      // Get version
      let version: string | undefined;
      try {
        version = execSync('npx --version', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        // Version detection failed, but npx exists
      }

      return {
        name: 'npx',
        available: true,
        version,
        path,
      };
    } catch (error) {
      return {
        name: 'npx',
        available: false,
        error: error instanceof Error ? error.message : 'npx not found in PATH',
      };
    }
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
