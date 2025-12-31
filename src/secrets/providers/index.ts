/**
 * Encryption providers index
 */

export { PlainProvider } from './plain.js';
export { DpapiProvider } from './dpapi.js';

import type { IEncryptionProvider, ProviderType } from '../types.js';
import { PlainProvider } from './plain.js';
import { DpapiProvider } from './dpapi.js';

/**
 * Get the best available encryption provider for the current platform
 *
 * Priority:
 * 1. DPAPI on Windows
 * 2. Keychain on macOS (future)
 * 3. Plain fallback (no encryption, with warning)
 */
export function getBestProvider(): IEncryptionProvider {
  // Try DPAPI first (Windows)
  const dpapi = new DpapiProvider();
  if (dpapi.isAvailable()) {
    return dpapi;
  }

  // TODO: Add macOS Keychain support
  // const keychain = new KeychainProvider();
  // if (keychain.isAvailable()) {
  //   return keychain;
  // }

  // Fallback to plain (no encryption)
  console.warn('Warning: No secure encryption provider available. Secrets will be stored without encryption.');
  return new PlainProvider();
}

/**
 * Get a specific provider by type
 */
export function getProvider(type: ProviderType): IEncryptionProvider {
  switch (type) {
    case 'dpapi':
      return new DpapiProvider();
    case 'plain':
      return new PlainProvider();
    case 'keychain':
      // Not yet implemented
      throw new Error('Keychain provider not yet implemented');
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}
