/**
 * Windows DPAPI encryption provider (Phase 3.5)
 *
 * Uses Windows Data Protection API with CurrentUser scope.
 * Secrets are encrypted using the user's Windows credentials.
 *
 * Implementation uses PowerShell to call .NET's ProtectedData class.
 *
 * v0.7.2: Uses -EncodedCommand to avoid PowerShell quoting/escaping issues.
 *         See: https://docs.microsoft.com/en-us/powershell/scripting/powershell-faq#EncodedCommand
 */

import { execSync } from 'child_process';
import type { IEncryptionProvider, ProviderType } from '../types.js';

/** Maximum ciphertext length (100KB base64 encoded) */
const MAX_CIPHERTEXT_LENGTH = 100000;

/** Valid base64 pattern (strict validation for command injection prevention) */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validate that a string is valid base64 format
 * Security: Prevents command injection by ensuring only safe characters
 */
function isValidBase64(value: string): boolean {
  if (!value || value.length === 0) {
    return false;
  }
  if (value.length > MAX_CIPHERTEXT_LENGTH) {
    return false;
  }
  return BASE64_PATTERN.test(value);
}

/**
 * Encode a PowerShell script for use with -EncodedCommand
 *
 * PowerShell -EncodedCommand requires:
 * 1. Script encoded as UTF-16LE (Little Endian)
 * 2. Then base64 encoded
 *
 * This avoids all quoting/escaping issues with nested quotes and special characters.
 *
 * @param script - PowerShell script to encode
 * @returns Base64-encoded UTF-16LE script
 */
export function encodePowerShellScript(script: string): string {
  // Convert to UTF-16LE (each character = 2 bytes, little endian)
  const utf16leBuffer = Buffer.alloc(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    const charCode = script.charCodeAt(i);
    utf16leBuffer.writeUInt16LE(charCode, i * 2);
  }
  return utf16leBuffer.toString('base64');
}

/**
 * DPAPI provider - Windows Data Protection API
 *
 * Encrypts data using the current Windows user's credentials.
 * Data can only be decrypted by the same user on the same machine.
 */
export class DpapiProvider implements IEncryptionProvider {
  readonly type: ProviderType = 'dpapi';

  isAvailable(): boolean {
    // Only available on Windows
    return process.platform === 'win32';
  }

  async encrypt(plaintext: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('DPAPI is only available on Windows');
    }

    // Convert plaintext to base64 for safe PowerShell handling
    const base64Input = Buffer.from(plaintext, 'utf-8').toString('base64');

    // PowerShell script to encrypt using DPAPI
    // Note: Variable interpolation happens at script creation time,
    // so the base64 string is embedded directly in the script
    // $ProgressPreference suppresses CLIXML progress output that can leak through
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$bytes = [System.Convert]::FromBase64String("${base64Input}")
$encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Convert]::ToBase64String($encrypted)
`.trim();

    // Encode script as UTF-16LE base64 for -EncodedCommand
    const encodedScript = encodePowerShellScript(script);

    try {
      const result = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedScript}`, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000,
      });
      return result.trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`DPAPI encryption failed: ${message}`);
    }
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('DPAPI is only available on Windows');
    }

    // Security: Validate ciphertext format to prevent command injection
    if (!isValidBase64(ciphertext)) {
      throw new Error('Invalid ciphertext format: must be valid base64');
    }

    // PowerShell script to decrypt using DPAPI
    // Note: Variable interpolation happens at script creation time
    // $ProgressPreference suppresses CLIXML progress output that can leak through
    const script = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$encrypted = [System.Convert]::FromBase64String("${ciphertext}")
$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.Convert]::ToBase64String($bytes)
`.trim();

    // Encode script as UTF-16LE base64 for -EncodedCommand
    const encodedScript = encodePowerShellScript(script);

    try {
      const result = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encodedScript}`, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000,
      });
      // Result is base64 encoded plaintext
      return Buffer.from(result.trim(), 'base64').toString('utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`DPAPI decryption failed: ${message}`);
    }
  }
}
