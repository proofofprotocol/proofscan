/**
 * Platform detection utilities
 *
 * Provides functions to detect the current platform and shell environment.
 * Used primarily to disable spinner on Windows/PowerShell where CLIXML
 * progress output causes issues.
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
 * - PSModulePath: Set by PowerShell for module resolution
 * - PSExecutionPolicyPreference: Set when execution policy is configured
 * - POWERSHELL_DISTRIBUTION_CHANNEL: Set by PowerShell Core
 *
 * This is a heuristic - we prefer false positives (disabling spinner when not needed)
 * over false negatives (showing spinner when it causes CLIXML issues).
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
 * Returns true if we should NOT show spinner by default:
 * - Windows platform (CLIXML progress issues)
 * - PowerShell host (even on non-Windows, PSCore may have issues)
 */
export function shouldDisableSpinnerByDefault(): boolean {
  return isWindows() || isPowerShellHost();
}
