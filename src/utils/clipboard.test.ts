/**
 * Tests for clipboard utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { platform } from 'os';

// Mock child_process and os modules
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('os', () => ({
  platform: vi.fn(),
}));

// Import after mocking
import { readClipboard, isClipboardAvailable } from './clipboard.js';

const mockExecSync = vi.mocked(execSync);
const mockPlatform = vi.mocked(platform);

describe('readClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads clipboard on Windows using PowerShell', () => {
    mockPlatform.mockReturnValue('win32');
    mockExecSync.mockReturnValue('{"id": "test", "command": "node"}');

    const result = readClipboard();

    expect(result).toBe('{"id": "test", "command": "node"}');
    expect(mockExecSync).toHaveBeenCalledWith(
      'powershell.exe -NoProfile -Command "Get-Clipboard -Raw"',
      expect.any(Object)
    );
  });

  it('reads clipboard on macOS using pbpaste', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockReturnValue('{"id": "mac-server", "command": "python"}');

    const result = readClipboard();

    expect(result).toBe('{"id": "mac-server", "command": "python"}');
    expect(mockExecSync).toHaveBeenCalledWith('pbpaste', expect.any(Object));
  });

  it('reads clipboard on Linux using wl-paste first', () => {
    mockPlatform.mockReturnValue('linux');
    mockExecSync.mockReturnValue('{"id": "linux-server", "command": "bash"}');

    const result = readClipboard();

    expect(result).toBe('{"id": "linux-server", "command": "bash"}');
    expect(mockExecSync).toHaveBeenCalledWith(
      'wl-paste --no-newline 2>/dev/null',
      expect.any(Object)
    );
  });

  it('falls back to xclip on Linux when wl-paste fails', () => {
    mockPlatform.mockReturnValue('linux');
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('wl-paste not found');
      })
      .mockReturnValue('{"id": "x11-server", "command": "node"}');

    const result = readClipboard();

    expect(result).toBe('{"id": "x11-server", "command": "node"}');
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenLastCalledWith(
      'xclip -selection clipboard -o',
      expect.any(Object)
    );
  });

  it('throws error on unsupported platform', () => {
    mockPlatform.mockReturnValue('freebsd');

    expect(() => readClipboard()).toThrow('Unsupported platform: freebsd');
  });

  it('throws error with hint when clipboard read fails', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockImplementation(() => {
      throw new Error('pbpaste failed');
    });

    expect(() => readClipboard()).toThrow(/Failed to read clipboard/);
    expect(() => readClipboard()).toThrow(/--file/);
    expect(() => readClipboard()).toThrow(/stdin/);
  });
});

describe('isClipboardAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true on Windows when powershell is available', () => {
    mockPlatform.mockReturnValue('win32');
    mockExecSync.mockReturnValue('');

    expect(isClipboardAvailable()).toBe(true);
  });

  it('returns true on macOS when pbpaste is available', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockReturnValue('/usr/bin/pbpaste');

    expect(isClipboardAvailable()).toBe(true);
  });

  it('returns true on Linux when wl-paste is available', () => {
    mockPlatform.mockReturnValue('linux');
    mockExecSync.mockReturnValue('/usr/bin/wl-paste');

    expect(isClipboardAvailable()).toBe(true);
  });

  it('returns true on Linux when xclip is available as fallback', () => {
    mockPlatform.mockReturnValue('linux');
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('not found');
      })
      .mockReturnValue('/usr/bin/xclip');

    expect(isClipboardAvailable()).toBe(true);
  });

  it('returns false when no clipboard tools available', () => {
    mockPlatform.mockReturnValue('linux');
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(isClipboardAvailable()).toBe(false);
  });

  it('returns false on unsupported platform', () => {
    mockPlatform.mockReturnValue('freebsd');

    expect(isClipboardAvailable()).toBe(false);
  });
});
