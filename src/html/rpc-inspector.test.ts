/**
 * RPC Inspector Tests (Phase 11.5)
 */

import { describe, it, expect } from 'vitest';
import {
  escapeJsonPointer,
  renderJsonWithPaths,
  renderMethodSummary,
  renderSummaryRowsHtml,
  detectSensitiveKeys,
  hasSensitiveContent,
} from './rpc-inspector.js';

describe('escapeJsonPointer', () => {
  it('should escape tilde characters', () => {
    expect(escapeJsonPointer('foo~bar')).toBe('foo~0bar');
  });

  it('should escape forward slash characters', () => {
    expect(escapeJsonPointer('foo/bar')).toBe('foo~1bar');
  });

  it('should escape both tilde and slash', () => {
    expect(escapeJsonPointer('foo~/bar')).toBe('foo~0~1bar');
  });

  it('should handle empty string', () => {
    expect(escapeJsonPointer('')).toBe('');
  });

  it('should handle string without special characters', () => {
    expect(escapeJsonPointer('foobar')).toBe('foobar');
  });

  it('should handle multiple special characters', () => {
    expect(escapeJsonPointer('a/b~c/d~e')).toBe('a~1b~0c~1d~0e');
  });
});

describe('renderJsonWithPaths', () => {
  it('should render null value', () => {
    const html = renderJsonWithPaths(null);
    expect(html).toContain('data-path="#"');
    expect(html).toContain('json-null');
    expect(html).toContain('null');
  });

  it('should render boolean value', () => {
    const html = renderJsonWithPaths(true);
    expect(html).toContain('data-path="#"');
    expect(html).toContain('json-bool');
    expect(html).toContain('true');
  });

  it('should render number value', () => {
    const html = renderJsonWithPaths(42);
    expect(html).toContain('data-path="#"');
    expect(html).toContain('json-number');
    expect(html).toContain('42');
  });

  it('should render string value', () => {
    const html = renderJsonWithPaths('hello');
    expect(html).toContain('data-path="#"');
    expect(html).toContain('json-string');
    expect(html).toContain('"hello"');
  });

  it('should render simple object with paths', () => {
    const json = { name: 'test', value: 123 };
    const html = renderJsonWithPaths(json);

    expect(html).toContain('data-path="#"');
    expect(html).toContain('data-path="#/name"');
    expect(html).toContain('data-path="#/value"');
    expect(html).toContain('"test"');
    expect(html).toContain('123');
  });

  it('should render nested object with correct paths', () => {
    const json = { outer: { inner: 'value' } };
    const html = renderJsonWithPaths(json);

    expect(html).toContain('data-path="#"');
    expect(html).toContain('data-path="#/outer"');
    expect(html).toContain('data-path="#/outer/inner"');
  });

  it('should render array with index paths', () => {
    const json = ['a', 'b', 'c'];
    const html = renderJsonWithPaths(json);

    expect(html).toContain('data-path="#"');
    expect(html).toContain('data-path="#/0"');
    expect(html).toContain('data-path="#/1"');
    expect(html).toContain('data-path="#/2"');
  });

  it('should render tools/list response with correct paths', () => {
    const json = {
      result: {
        tools: [
          { name: 'read_file', description: 'Read a file' },
          { name: 'write_file', description: 'Write a file' },
        ],
      },
    };
    const html = renderJsonWithPaths(json);

    expect(html).toContain('data-path="#/result"');
    expect(html).toContain('data-path="#/result/tools"');
    expect(html).toContain('data-path="#/result/tools/0"');
    expect(html).toContain('data-path="#/result/tools/0/name"');
    expect(html).toContain('data-path="#/result/tools/1"');
    expect(html).toContain('data-path="#/result/tools/1/name"');
  });

  it('should escape special characters in keys', () => {
    const json = { 'key/with/slash': 'value', 'key~with~tilde': 'value' };
    const html = renderJsonWithPaths(json);

    expect(html).toContain('data-path="#/key~1with~1slash"');
    expect(html).toContain('data-path="#/key~0with~0tilde"');
  });

  it('should handle undefined/null input gracefully', () => {
    const html = renderJsonWithPaths(undefined);
    expect(html).toContain('(no data)');
  });
});

describe('renderMethodSummary', () => {
  describe('tools/list method', () => {
    it('should render tools table for tools/list response', () => {
      const response = {
        result: {
          tools: [
            { name: 'read_file', description: 'Read a file' },
            { name: 'write_file', description: 'Write a file' },
          ],
        },
      };

      const rows = renderMethodSummary('tools/list', {}, response);

      // Should have method header + tools header + 2 tool rows
      expect(rows.length).toBe(4);
      expect(rows[0].type).toBe('header');
      expect(rows[0].label).toBe('Method: tools/list');
      expect(rows[1].type).toBe('header');
      expect(rows[1].label).toBe('Tools (2)');

      // First tool
      expect(rows[2].type).toBe('item');
      expect(rows[2].label).toBe('read_file');
      expect(rows[2].value).toBe('Read a file');
      expect(rows[2].pointer).toEqual({
        target: 'response',
        path: '#/result/tools/0',
      });

      // Second tool
      expect(rows[3].type).toBe('item');
      expect(rows[3].label).toBe('write_file');
      expect(rows[3].pointer).toEqual({
        target: 'response',
        path: '#/result/tools/1',
      });
    });

    it('should render inputSchema properties as children', () => {
      const response = {
        result: {
          tools: [
            {
              name: 'read_file',
              description: 'Read a file',
              inputSchema: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'File path' },
                  encoding: { type: 'string', description: 'Encoding' },
                },
                required: ['path'],
              },
            },
          ],
        },
      };

      const rows = renderMethodSummary('tools/list', {}, response);

      // Tool row should have children (row[2] is first tool after 2 headers)
      expect(rows[2].children).toBeDefined();
      expect(rows[2].children!.length).toBe(2);

      // path property (required)
      const pathProp = rows[2].children![0];
      expect(pathProp.label).toBe('path');
      expect(pathProp.value).toBe('string (required)');
      expect(pathProp.cssClass).toBe('schema-required');
      expect(pathProp.pointer).toEqual({
        target: 'response',
        path: '#/result/tools/0/inputSchema/properties/path',
      });

      // encoding property (optional)
      const encodingProp = rows[2].children![1];
      expect(encodingProp.label).toBe('encoding');
      expect(encodingProp.value).toBe('string');
      expect(encodingProp.cssClass).toBe('schema-optional');
    });

    it('should handle empty tools array', () => {
      const response = { result: { tools: [] } };
      const rows = renderMethodSummary('tools/list', {}, response);

      // Method header + empty message
      expect(rows.length).toBe(2);
      expect(rows[0].label).toBe('Method: tools/list');
      expect(rows[1].label).toBe('(no tools available)');
    });

    it('should handle missing tools in response', () => {
      const response = { result: {} };
      const rows = renderMethodSummary('tools/list', {}, response);

      // Method header + empty message
      expect(rows.length).toBe(2);
      expect(rows[0].label).toBe('Method: tools/list');
      expect(rows[1].label).toBe('(no tools available)');
    });
  });

  describe('generic method fallback', () => {
    it('should render generic summary for unknown methods', () => {
      const request = { params: { query: 'test' } };
      const response = { result: { data: [1, 2, 3] } };

      const rows = renderMethodSummary('custom/method', request, response);

      // Should have method header (appears twice: once for request, once for response)
      expect(rows[0].type).toBe('header');
      expect(rows[0].label).toBe('Method: custom/method');

      // Should have parameters section
      const paramHeader = rows.find(
        (r) => r.label === 'Parameters' && r.type === 'header'
      );
      expect(paramHeader).toBeDefined();

      // Should have query param row
      const queryRow = rows.find((r) => r.label === 'query');
      expect(queryRow).toBeDefined();
      expect(queryRow!.pointer?.target).toBe('request');
      expect(queryRow!.pointer?.path).toBe('#/params/query');

      // Should have response result section
      const resultHeader = rows.find(
        (r) => r.label === 'Result' && r.type === 'header'
      );
      expect(resultHeader).toBeDefined();
    });

    it('should render error section for error responses', () => {
      const response = {
        error: { code: -32600, message: 'Invalid Request' },
      };

      const rows = renderMethodSummary('custom/method', {}, response);

      const errorHeader = rows.find(
        (r) => r.label === 'Error' && r.type === 'header'
      );
      expect(errorHeader).toBeDefined();

      // Error object properties are shown as separate rows (code, message)
      const codeRow = rows.find((r) => r.label === 'code');
      expect(codeRow).toBeDefined();
      expect(codeRow!.pointer?.target).toBe('response');
      expect(codeRow!.pointer?.path).toBe('#/error/code');
    });
  });
});

describe('renderSummaryRowsHtml', () => {
  it('should render header row', () => {
    const rows = [{ type: 'header' as const, label: 'Tools (3)' }];
    const html = renderSummaryRowsHtml(rows);

    expect(html).toContain('summary-row');
    expect(html).toContain('summary-header');
    expect(html).toContain('Tools (3)');
  });

  it('should render item row with pointer attributes', () => {
    const rows = [
      {
        type: 'item' as const,
        label: 'read_file',
        value: 'Read a file',
        pointer: { target: 'response' as const, path: '#/result/tools/0' },
      },
    ];
    const html = renderSummaryRowsHtml(rows);

    expect(html).toContain('summary-item');
    expect(html).toContain('clickable');
    expect(html).toContain('data-pointer-target="response"');
    expect(html).toContain('data-pointer-path="#/result/tools/0"');
    expect(html).toContain('read_file');
    expect(html).toContain('Read a file');
  });

  it('should render property row', () => {
    const rows = [
      {
        type: 'property' as const,
        label: 'path',
        value: 'string (required)',
        cssClass: 'schema-required',
        pointer: {
          target: 'response' as const,
          path: '#/result/tools/0/inputSchema/properties/path',
        },
      },
    ];
    const html = renderSummaryRowsHtml(rows);

    expect(html).toContain('summary-property');
    expect(html).toContain('schema-required');
    expect(html).toContain('summary-prop-name');
    expect(html).toContain('path');
  });

  it('should render children recursively', () => {
    const rows = [
      {
        type: 'item' as const,
        label: 'tool',
        value: 'desc',
        children: [
          {
            type: 'property' as const,
            label: 'prop1',
            value: 'string',
          },
        ],
      },
    ];
    const html = renderSummaryRowsHtml(rows);

    expect(html).toContain('summary-children');
    expect(html).toContain('prop1');
  });

  it('should escape HTML in labels and values', () => {
    const rows = [
      {
        type: 'item' as const,
        label: '<script>alert("xss")</script>',
        value: '<img src=x onerror=alert(1)>',
      },
    ];
    const html = renderSummaryRowsHtml(rows);

    // Should not contain raw HTML tags (which would be executable)
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    // Should contain escaped versions
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });
});

describe('detectSensitiveKeys', () => {
  it('should detect authorization header', () => {
    const json = { headers: { authorization: 'Bearer xxx' } };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('headers.authorization');
  });

  it('should detect api_key and api-key variations', () => {
    const json = { api_key: 'xxx', config: { 'api-key': 'yyy' } };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('api_key');
    expect(keys).toContain('config.api-key');
  });

  it('should detect token and access_token', () => {
    const json = { token: 'xxx', auth: { access_token: 'yyy', refresh_token: 'zzz' } };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('token');
    expect(keys).toContain('auth.access_token');
    expect(keys).toContain('auth.refresh_token');
  });

  it('should detect password and secret', () => {
    const json = { password: 'xxx', db: { secret: 'yyy' } };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('password');
    expect(keys).toContain('db.secret');
  });

  it('should detect private_key and credential', () => {
    const json = { private_key: 'xxx', credential: 'yyy' };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('private_key');
    expect(keys).toContain('credential');
  });

  it('should detect bearer and signature', () => {
    const json = { bearer: 'xxx', signature: 'yyy' };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('bearer');
    expect(keys).toContain('signature');
  });

  it('should detect session_id and cookie', () => {
    const json = { session_id: 'xxx', cookie: 'yyy' };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('session_id');
    expect(keys).toContain('cookie');
  });

  it('should detect auth-related keys case-insensitively', () => {
    const json = { Authorization: 'xxx', API_KEY: 'yyy', Token: 'zzz' };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('Authorization');
    expect(keys).toContain('API_KEY');
    expect(keys).toContain('Token');
  });

  it('should traverse nested objects', () => {
    const json = {
      level1: {
        level2: {
          level3: {
            secret: 'hidden',
          },
        },
      },
    };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('level1.level2.level3.secret');
  });

  it('should traverse arrays', () => {
    const json = {
      items: [
        { name: 'safe' },
        { password: 'hidden' },
        { api_key: 'xxx' },
      ],
    };
    const keys = detectSensitiveKeys(json);
    expect(keys).toContain('items[1].password');
    expect(keys).toContain('items[2].api_key');
  });

  it('should return empty array for safe data', () => {
    const json = { name: 'test', value: 123, items: ['a', 'b'] };
    const keys = detectSensitiveKeys(json);
    expect(keys).toEqual([]);
  });

  it('should handle null and undefined', () => {
    expect(detectSensitiveKeys(null)).toEqual([]);
    expect(detectSensitiveKeys(undefined)).toEqual([]);
  });

  it('should handle primitive values', () => {
    expect(detectSensitiveKeys('string')).toEqual([]);
    expect(detectSensitiveKeys(123)).toEqual([]);
    expect(detectSensitiveKeys(true)).toEqual([]);
  });

  it('should handle empty object and array', () => {
    expect(detectSensitiveKeys({})).toEqual([]);
    expect(detectSensitiveKeys([])).toEqual([]);
  });
});

describe('hasSensitiveContent', () => {
  it('should return true when sensitive keys exist', () => {
    const json = { authorization: 'Bearer xxx' };
    expect(hasSensitiveContent(json)).toBe(true);
  });

  it('should return false when no sensitive keys exist', () => {
    const json = { name: 'test', value: 123 };
    expect(hasSensitiveContent(json)).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(hasSensitiveContent(null)).toBe(false);
    expect(hasSensitiveContent(undefined)).toBe(false);
  });

  it('should detect nested sensitive content', () => {
    const json = { config: { db: { password: 'xxx' } } };
    expect(hasSensitiveContent(json)).toBe(true);
  });
});
