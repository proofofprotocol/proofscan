/**
 * Output utilities for CLI
 */

export interface OutputOptions {
  json?: boolean;
  verbose?: boolean;
}

let globalOptions: OutputOptions = {};

export function setOutputOptions(options: OutputOptions): void {
  globalOptions = { ...globalOptions, ...options };
}

export function getOutputOptions(): OutputOptions {
  return globalOptions;
}

export function output(data: unknown, humanReadable?: string): void {
  if (globalOptions.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(humanReadable ?? String(data));
  }
}

export function outputError(message: string, error?: Error): void {
  if (globalOptions.json) {
    console.error(JSON.stringify({
      error: message,
      details: error?.message,
    }));
  } else {
    console.error(`Error: ${message}`);
    if (error && globalOptions.verbose) {
      console.error(error.stack);
    }
  }
}

export function outputSuccess(message: string, data?: unknown): void {
  if (globalOptions.json) {
    const result: { success: boolean; message: string; data?: unknown } = {
      success: true,
      message,
    };
    if (data !== undefined) {
      result.data = data;
    }
    console.log(JSON.stringify(result));
  } else {
    console.log(`✓ ${message}`);
  }
}

export function outputTable(headers: string[], rows: string[][]): void {
  if (globalOptions.json) {
    const objects = rows.map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] ?? '';
      });
      return obj;
    });
    console.log(JSON.stringify(objects, null, 2));
    return;
  }

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const cellWidths = [h.length, ...rows.map(r => (r[i] ?? '').length)];
    return Math.max(...cellWidths);
  });

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(headerLine);
  console.log('-'.repeat(headerLine.length));

  // Print rows
  for (const row of rows) {
    console.log(row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  '));
  }
}

/**
 * Mask sensitive values for display
 */
export function maskSecret(value: string, showChars: number = 4): string {
  if (value.length <= showChars * 2) {
    return '****';
  }
  return value.slice(0, showChars) + '****' + value.slice(-showChars);
}

/**
 * Mask secrets in an object (for display)
 */
export function maskSecretsInObject(obj: unknown, secretKeys: string[] = ['token', 'key', 'secret', 'password', 'auth']): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => maskSecretsInObject(item, secretKeys));
  }

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const isSecret = secretKeys.some(sk => key.toLowerCase().includes(sk));
    if (isSecret && typeof value === 'string') {
      masked[key] = maskSecret(value);
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSecretsInObject(value, secretKeys);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
