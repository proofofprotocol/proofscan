/**
 * Tests for platform detection utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isWindows,
  isPowerShellHost,
  isInteractiveTTY,
  shouldDisableSpinnerByDefault,
} from './platform.js';

describe('platform detection', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;
  const originalStderr = process.stderr.isTTY;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original values
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = originalEnv;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdin, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdout, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: originalStderr, configurable: true });
  });

  describe('isWindows', () => {
    it('should return true on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isWindows()).toBe(true);
    });

    it('should return false on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(isWindows()).toBe(false);
    });

    it('should return false on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(isWindows()).toBe(false);
    });
  });

  describe('isPowerShellHost', () => {
    beforeEach(() => {
      // Clear PowerShell-related env vars
      delete process.env.PSModulePath;
      delete process.env.POWERSHELL_DISTRIBUTION_CHANNEL;
      delete process.env.ComSpec;
    });

    it('should return true when PSModulePath is set', () => {
      process.env.PSModulePath = 'C:\\Users\\test\\Documents\\WindowsPowerShell\\Modules';
      expect(isPowerShellHost()).toBe(true);
    });

    it('should return true when POWERSHELL_DISTRIBUTION_CHANNEL is set', () => {
      process.env.POWERSHELL_DISTRIBUTION_CHANNEL = 'MSI:Windows 10.0.19041';
      expect(isPowerShellHost()).toBe(true);
    });

    it('should return true when ComSpec contains powershell', () => {
      process.env.ComSpec = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      expect(isPowerShellHost()).toBe(true);
    });

    it('should return false when no PowerShell indicators', () => {
      process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
      expect(isPowerShellHost()).toBe(false);
    });

    it('should return false when ComSpec is empty', () => {
      expect(isPowerShellHost()).toBe(false);
    });
  });

  describe('isInteractiveTTY', () => {
    it('should return true when all streams are TTY', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
      expect(isInteractiveTTY()).toBe(true);
    });

    it('should return false when stdin is not TTY', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
      expect(isInteractiveTTY()).toBe(false);
    });

    it('should return false when stdout is not TTY', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
      expect(isInteractiveTTY()).toBe(false);
    });

    it('should return false when stderr is not TTY', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
      expect(isInteractiveTTY()).toBe(false);
    });

    it('should return false when stdin.isTTY is undefined', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
      expect(isInteractiveTTY()).toBe(false);
    });
  });

  describe('shouldDisableSpinnerByDefault', () => {
    // Since v0.10.14, spinner is enabled on all platforms (CLIXML issue fixed in DPAPI)
    it('should return false on all platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(shouldDisableSpinnerByDefault()).toBe(false);

      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(shouldDisableSpinnerByDefault()).toBe(false);

      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(shouldDisableSpinnerByDefault()).toBe(false);
    });

    it('should return false even in PowerShell host', () => {
      process.env.PSModulePath = '/home/user/.local/share/powershell/Modules';
      expect(shouldDisableSpinnerByDefault()).toBe(false);
    });
  });
});
