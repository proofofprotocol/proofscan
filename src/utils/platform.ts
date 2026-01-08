/**
 * Platform detection utilities
 *
 * Provides functions to detect the current platform and shell environment.
 */

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if running in a PowerShell host environment
 *
 * Detects PowerShell by checking for common environment variables:
 * - PSModulePath: Set by PowerShell for module resolution (most reliable)
 * - POWERSHELL_DISTRIBUTION_CHANNEL: Set by PowerShell Core
 * - ComSpec: Fallback check for Windows (if contains 'powershell')
 */
export function isPowerShellHost(): boolean {
  // PSModulePath is the most reliable indicator
  if (process.env.PSModulePath) {
    return true;
  }

  // PowerShell Core sets this
  if (process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
    return true;
  }

  // Check if parent shell looks like PowerShell
  const comSpec = process.env.ComSpec || '';
  if (comSpec.toLowerCase().includes('powershell')) {
    return true;
  }

  return false;
}

/**
 * Check if running in an interactive TTY environment
 *
 * All three streams (stdin, stdout, stderr) should be TTY for
 * truly interactive use where spinner makes sense.
 */
export function isInteractiveTTY(): boolean {
  return (
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    process.stderr.isTTY === true
  );
}

/**
 * Check if spinner should be disabled by default due to platform
 *
 * Previously disabled on Windows/PowerShell due to CLIXML issues,
 * but this was fixed in v0.10.14 by suppressing PowerShell progress
 * output in DPAPI calls.
 *
 * Now returns false (spinner enabled) on all platforms.
 */
export function shouldDisableSpinnerByDefault(): boolean {
  return false;
}
