import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveConfigPath, getDefaultConfigDir, getDefaultConfigPath } from './config-path.js';
import { platform, homedir } from 'os';
import { join } from 'path';

describe('config-path', () => {
  describe('resolveConfigPath', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should prioritize --config argument', () => {
      process.env.PROOFSCAN_CONFIG = '/env/path/config.json';
      const result = resolveConfigPath({ configPath: '/custom/config.json' });
      expect(result).toBe('/custom/config.json');
    });

    it('should use PROOFSCAN_CONFIG if no --config', () => {
      process.env.PROOFSCAN_CONFIG = '/env/path/config.json';
      const result = resolveConfigPath({});
      expect(result).toBe('/env/path/config.json');
    });

    it('should use OS default if no --config or env', () => {
      delete process.env.PROOFSCAN_CONFIG;
      const result = resolveConfigPath({});
      expect(result).toBe(getDefaultConfigPath());
    });
  });

  describe('getDefaultConfigDir', () => {
    it('should return a path containing proofscan', () => {
      const dir = getDefaultConfigDir();
      expect(dir).toContain('proofscan');
    });

    it('should be under home directory', () => {
      const dir = getDefaultConfigDir();
      const home = homedir();
      // On all platforms, config should be under home
      expect(dir.startsWith(home) || dir.includes('AppData')).toBe(true);
    });
  });

  describe('getDefaultConfigPath', () => {
    it('should end with config.json', () => {
      const path = getDefaultConfigPath();
      expect(path.endsWith('config.json')).toBe(true);
    });
  });
});
