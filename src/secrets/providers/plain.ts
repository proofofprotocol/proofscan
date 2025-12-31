/**
 * Plain encryption provider (no encryption)
 *
 * This is a fallback provider for testing and platforms without
 * native encryption support. It provides NO security and should
 * only be used for development/testing purposes.
 */

import type { IEncryptionProvider, ProviderType } from '../types.js';

/**
 * Plain provider - stores secrets as base64 without encryption
 *
 * WARNING: This provider offers NO security. Secrets are only
 * base64 encoded, not encrypted. Use only for testing.
 */
export class PlainProvider implements IEncryptionProvider {
  readonly type: ProviderType = 'plain';

  isAvailable(): boolean {
    // Always available as fallback
    return true;
  }

  async encrypt(plaintext: string): Promise<string> {
    // Just base64 encode - NO ENCRYPTION
    return Buffer.from(plaintext, 'utf-8').toString('base64');
  }

  async decrypt(ciphertext: string): Promise<string> {
    // Just base64 decode
    return Buffer.from(ciphertext, 'base64').toString('utf-8');
  }
}
