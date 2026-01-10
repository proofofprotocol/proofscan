/**
 * uvx Runner implementation
 * Executes Python packages via uv's uvx command
 */

import { execSync } from 'child_process';
import type { Runner, RunnerStatus, PackageRef, MaterializedTransport } from './types.js';

/**
 * uvx Runner class
 */
export class UvxRunner implements Runner {
  readonly name = 'uvx' as const;

  /**
   * Detect if uvx is available on the system
   */
  async detect(): Promise<RunnerStatus> {
    try {
      // Use 'which' on Unix, 'where' on Windows
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const pathOutput = execSync(`${whichCmd} uvx`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // Take first line (Windows 'where' may return multiple paths)
      const path = pathOutput.split('\n')[0].trim();

      // Get version
      let version: string | undefined;
      try {
        version = execSync('uvx --version', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        // Version detection failed, but uvx exists
      }

      return {
        name: 'uvx',
        available: true,
        version,
        path,
      };
    } catch (error) {
      return {
        name: 'uvx',
        available: false,
        error: error instanceof Error ? error.message : 'uvx not found in PATH',
      };
    }
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
