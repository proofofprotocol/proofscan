import { describe, it, expect } from 'vitest';
import { normalizeMcpEvent, normalizeA2aEvent } from '../normalizer.js';

describe('normalizeMcpEvent', () => {
  it('should normalize tools/call request', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_weather',
        arguments: { city: 'Tokyo' },
      },
    };

    const result = normalizeMcpEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('tool_call');
    expect(result?.protocol).toBe('mcp');
    expect(result?.content).toEqual({
      type: 'tool_call',
      name: 'get_weather',
      arguments: { city: 'Tokyo' },
    });
  });

  it('should normalize tools/call response', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: 'Sunny, 25°C' }],
        isError: false,
      },
    };

    const result = normalizeMcpEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('tool_result');
    expect(result?.protocol).toBe('mcp');
    expect(result?.content).toMatchObject({
      type: 'tool_result',
      name: 'tool',
      isError: false,
    });
  });

  it('should normalize tools/call response with error', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: 'Tool failed' }],
        isError: true,
      },
    };

    const result = normalizeMcpEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('tool_result');
    expect(result?.content).toMatchObject({
      type: 'tool_result',
      isError: true,
    });
  });

  it('should return null for unrecognized MCP events', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 1,
      method: 'unknown/method',
    };

    const result = normalizeMcpEvent(raw);

    expect(result).toBeNull();
  });

  it('should handle missing params gracefully', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
    };

    const result = normalizeMcpEvent(raw);

    expect(result).toBeDefined();
    expect(result?.content).toEqual({
      type: 'tool_call',
      name: 'unknown',
      arguments: {},
    });
  });

  it('should return null for non-object input', () => {
    expect(normalizeMcpEvent(null)).toBeNull();
    expect(normalizeMcpEvent(undefined)).toBeNull();
    expect(normalizeMcpEvent('string')).toBeNull();
    expect(normalizeMcpEvent(123)).toBeNull();
  });
});

describe('normalizeA2aEvent', () => {
  it('should normalize status event', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        taskId: 'task-123',
        status: 'working',
        message: {
          role: 'assistant',
          parts: [{ text: 'Processing...' }],
        },
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('status');
    expect(result?.protocol).toBe('a2a');
    expect(result?.content).toEqual({
      type: 'status',
      status: 'working',
      message: 'Processing...',
    });
  });

  it('should normalize message event with assistant role', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        role: 'assistant',
        parts: [{ text: 'Hello!' }],
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    expect(result?.protocol).toBe('a2a');
    expect(result?.actor).toBe('assistant');
    expect(result?.content).toEqual({
      type: 'text',
      text: 'Hello!',
    });
  });

  it('should normalize message event with user role', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        role: 'user',
        parts: [{ text: 'Help me' }],
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    expect(result?.actor).toBe('user');
    expect(result?.content).toEqual({
      type: 'text',
      text: 'Help me',
    });
  });

  it('should normalize artifact event', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        taskId: 'task-123',
        artifact: {
          name: 'report.pdf',
          parts: [{ data: 'base64...', mimeType: 'application/pdf' }],
        },
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('artifact');
    expect(result?.protocol).toBe('a2a');
    expect(result?.content).toMatchObject({
      type: 'artifact',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      data: 'base64...',
    });
  });

  it('should handle message with multiple text parts', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        role: 'assistant',
        parts: [
          { text: 'Hello ' },
          { text: 'World!' },
        ],
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    expect(result?.content).toEqual({
      type: 'text',
      text: 'Hello World!',
    });
  });

  it('should handle message with non-text parts', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        role: 'assistant',
        parts: [
          { data: 'base64...', mimeType: 'image/png' },
          { text: 'Here is the image' },
        ],
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    expect(result?.content).toEqual({
      type: 'text',
      text: 'Here is the image',
    });
  });

  it('should handle missing message', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        taskId: 'task-123',
        status: 'working',
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('status');
    expect(result?.content).toEqual({
      type: 'status',
      status: 'working',
      message: '',
    });
  });

  it('should handle artifact without name or mimeType', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        taskId: 'task-123',
        artifact: {
          parts: [{ data: 'some-data' }],
        },
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeDefined();
    expect(result?.type).toBe('artifact');
    expect(result?.content).toMatchObject({
      type: 'artifact',
      name: undefined,
      mimeType: undefined,
      data: 'some-data',
    });
  });

  it('should return null for unrecognized A2A events', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
      result: {
        unknownField: 'value',
      },
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(normalizeA2aEvent(null)).toBeNull();
    expect(normalizeA2aEvent(undefined)).toBeNull();
    expect(normalizeA2aEvent('string')).toBeNull();
    expect(normalizeA2aEvent(123)).toBeNull();
  });

  it('should return null when result is missing', () => {
    const raw = {
      jsonrpc: '2.0',
      id: 'req-1',
    };

    const result = normalizeA2aEvent(raw);

    expect(result).toBeNull();
  });
});
