/**
 * Windows DPAPI encryption provider (Phase 3.5)
 *
 * Uses Windows Data Protection API with CurrentUser scope.
 * Secrets are encrypted using the user's Windows credentials.
 *
 * Implementation uses PowerShell to call .NET's ProtectedData class.
 */

import { execSync } from 'child_process';
import type { IEncryptionProvider, ProviderType } from '../types.js';

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
    const script = `
      Add-Type -AssemblyName System.Security
      $bytes = [System.Convert]::FromBase64String("${base64Input}")
      $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.Convert]::ToBase64String($encrypted)
    `.trim().replace(/\n/g, '; ');

    try {
      const result = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
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

    // PowerShell script to decrypt using DPAPI
    const script = `
      Add-Type -AssemblyName System.Security
      $encrypted = [System.Convert]::FromBase64String("${ciphertext}")
      $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [System.Convert]::ToBase64String($bytes)
    `.trim().replace(/\n/g, '; ');

    try {
      const result = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
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
