/**
 * Tests for DPAPI provider utilities
 *
 * Note: Full DPAPI encrypt/decrypt tests require Windows.
 * These tests focus on the encodePowerShellScript helper which works cross-platform.
 */

import { describe, it, expect } from 'vitest';
import { encodePowerShellScript } from './dpapi.js';

describe('encodePowerShellScript', () => {
  it('should encode a simple script to UTF-16LE base64', () => {
    const script = 'echo "hello"';
    const encoded = encodePowerShellScript(script);

    // Decode and verify it's UTF-16LE
    const decoded = Buffer.from(encoded, 'base64');

    // UTF-16LE: each character is 2 bytes, little endian
    expect(decoded.length).toBe(script.length * 2);

    // Verify first character 'e' (0x0065 in little endian = 0x65, 0x00)
    expect(decoded[0]).toBe(0x65); // 'e'
    expect(decoded[1]).toBe(0x00);
  });

  it('should handle special characters correctly', () => {
    const script = 'Write-Host "Test with $variable and (parentheses)"';
    const encoded = encodePowerShellScript(script);

    // Should not throw and should produce valid base64
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);

    // Verify we can decode it back
    const decoded = Buffer.from(encoded, 'base64');
    expect(decoded.length).toBe(script.length * 2);
  });

  it('should handle multi-line scripts', () => {
    const script = `Add-Type -AssemblyName System.Security
$bytes = [System.Convert]::FromBase64String("SGVsbG8=")
[System.Convert]::ToBase64String($bytes)`;

    const encoded = encodePowerShellScript(script);

    // Should produce valid base64
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);

    // Decode and verify length
    const decoded = Buffer.from(encoded, 'base64');
    expect(decoded.length).toBe(script.length * 2);
  });

  it('should handle scripts with nested quotes', () => {
    // This is the problematic case that caused the original bug
    const base64Input = 'SGVsbG9Xb3JsZA=='; // "HelloWorld" in base64
    const script = `$bytes = [System.Convert]::FromBase64String("${base64Input}")`;

    const encoded = encodePowerShellScript(script);

    // Should produce valid base64 without issues
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);

    // Verify the nested quotes are preserved
    const decoded = Buffer.from(encoded, 'base64');
    const decodedScript = decodeUtf16Le(decoded);
    expect(decodedScript).toBe(script);
    expect(decodedScript).toContain('"');
    expect(decodedScript).toContain(base64Input);
  });

  it('should handle empty script', () => {
    const script = '';
    const encoded = encodePowerShellScript(script);
    expect(encoded).toBe('');
  });

  it('should handle scripts with various special characters', () => {
    const script = 'echo "quotes" \'single\' $var @() #{} | & ; < > !';
    const encoded = encodePowerShellScript(script);

    // Should produce valid base64
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);

    // Verify round-trip
    const decoded = Buffer.from(encoded, 'base64');
    const decodedScript = decodeUtf16Le(decoded);
    expect(decodedScript).toBe(script);
  });

  it('should produce correct output for known input', () => {
    // "Write-Output 'test'" in UTF-16LE base64
    const script = 'Write-Output test';
    const encoded = encodePowerShellScript(script);

    // Verify we can decode it back correctly
    const decoded = Buffer.from(encoded, 'base64');
    const decodedScript = decodeUtf16Le(decoded);
    expect(decodedScript).toBe(script);
  });
});

/**
 * Helper to decode UTF-16LE buffer to string
 */
function decodeUtf16Le(buffer: Buffer): string {
  let result = '';
  for (let i = 0; i < buffer.length; i += 2) {
    const charCode = buffer.readUInt16LE(i);
    result += String.fromCharCode(charCode);
  }
  return result;
}
