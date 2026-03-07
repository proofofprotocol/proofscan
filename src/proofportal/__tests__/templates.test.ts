/**
 * ProofPortal - Template tests
 * Phase 4: ProofPortal MVP
 */

import { describe, it, expect } from 'vitest';
import { renderDashboard } from '../templates/dashboard.js';
import { escapeHtml, renderLayout } from '../templates/layout.js';
import {
  createInitialState,
  applyEvent,
  toDisplayEvent,
  type PortalSseEvent,
} from '../types.js';

describe('ProofPortal templates', () => {
  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should escape ampersand', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#039;s');
    });
  });

  describe('renderLayout', () => {
    it('should render complete HTML document', () => {
      const html = renderLayout({
        title: 'Test Portal',
        content: '<div>Test content</div>',
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Test Portal</title>');
      expect(html).toContain('<div>Test content</div>');
      expect(html).toContain('data-app="portal"');
    });

    it('should include connection status element', () => {
      const html = renderLayout({
        title: 'Test',
        content: '',
      });

      expect(html).toContain('id="connectionStatus"');
      expect(html).toContain('connection-status');
    });

    it('should include scripts when provided', () => {
      const html = renderLayout({
        title: 'Test',
        content: '',
        scripts: 'console.log("test");',
      });

      expect(html).toContain('console.log("test");');
    });
  });

  describe('renderDashboard', () => {
    it('should render dashboard with three panels', () => {
      const html = renderDashboard({
        generatedAt: '2024-01-01T00:00:00Z',
      });

      expect(html).toContain('id="agentList"');
      expect(html).toContain('id="threadList"');
      expect(html).toContain('id="spaceList"');
    });

    it('should include SSE client script', () => {
      const html = renderDashboard({
        generatedAt: '2024-01-01T00:00:00Z',
      });

      expect(html).toContain('EventSource');
      expect(html).toContain('proofcomm_space');
    });

    it('should show generated timestamp', () => {
      const html = renderDashboard({
        generatedAt: '2024-01-01T00:00:00Z',
      });

      expect(html).toContain('2024-01-01T00:00:00Z');
    });
  });
});

describe('ProofPortal state management', () => {
  describe('createInitialState', () => {
    it('should create empty state', () => {
      const state = createInitialState();

      expect(state.threads.size).toBe(0);
      expect(state.spaces.size).toBe(0);
      expect(state.agents.size).toBe(0);
      expect(state.connected).toBe(false);
      expect(state.eventCount).toBe(0);
    });
  });

  describe('toDisplayEvent', () => {
    it('should convert SSE event to display format', () => {
      const event: PortalSseEvent = {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
        trace_id: 'trace-1',
        metadata: {
          action: 'message',
          space_id: 'space-1',
          space_name: 'Test Space',
          agent_id: 'agent-1',
          message_preview: 'Hello world',
        },
      };

      const display = toDisplayEvent(event);

      expect(display.id).toBe('req-1');
      expect(display.eventKind).toBe('proofcomm_space');
      expect(display.action).toBe('message');
      expect(display.traceId).toBe('trace-1');
      expect(display.spaceId).toBe('space-1');
      expect(display.spaceName).toBe('Test Space');
      expect(display.agentId).toBe('agent-1');
      expect(display.preview).toBe('Hello world');
    });

    it('should handle missing metadata', () => {
      const event: PortalSseEvent = {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
      };

      const display = toDisplayEvent(event);

      expect(display.traceId).toBeNull();
      expect(display.spaceId).toBeNull();
      expect(display.agentId).toBeNull();
    });
  });

  describe('applyEvent', () => {
    it('should update thread state', () => {
      const state = createInitialState();
      const event: PortalSseEvent = {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
        trace_id: 'trace-1',
        metadata: {
          action: 'message',
          agent_id: 'agent-1',
        },
      };

      applyEvent(state, event);

      expect(state.threads.size).toBe(1);
      expect(state.threads.get('trace-1')?.participants.has('agent-1')).toBe(true);
    });

    it('should update space state on join', () => {
      const state = createInitialState();
      const event: PortalSseEvent = {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
        metadata: {
          action: 'joined',
          space_id: 'space-1',
          agent_id: 'agent-1',
        },
      };

      applyEvent(state, event);

      expect(state.spaces.size).toBe(1);
      expect(state.spaces.get('space-1')?.members.has('agent-1')).toBe(true);
    });

    it('should update space state on leave', () => {
      const state = createInitialState();

      // First join
      applyEvent(state, {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
        metadata: {
          action: 'joined',
          space_id: 'space-1',
          agent_id: 'agent-1',
        },
      });

      // Then leave
      applyEvent(state, {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067201000,
        request_id: 'req-2',
        metadata: {
          action: 'left',
          space_id: 'space-1',
          agent_id: 'agent-1',
        },
      });

      expect(state.spaces.get('space-1')?.members.has('agent-1')).toBe(false);
    });

    it('should increment message count', () => {
      const state = createInitialState();
      const event: PortalSseEvent = {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
        metadata: {
          action: 'message',
          space_id: 'space-1',
        },
      };

      applyEvent(state, event);
      applyEvent(state, { ...event, request_id: 'req-2' });

      expect(state.spaces.get('space-1')?.messageCount).toBe(2);
    });

    it('should update agent state', () => {
      const state = createInitialState();
      const event: PortalSseEvent = {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
        trace_id: 'trace-1',
        metadata: {
          action: 'message',
          space_id: 'space-1',
          agent_id: 'agent-1',
        },
      };

      applyEvent(state, event);

      expect(state.agents.size).toBe(1);
      const agent = state.agents.get('agent-1');
      expect(agent?.eventCount).toBe(1);
      expect(agent?.traceIds.has('trace-1')).toBe(true);
      expect(agent?.spaceIds.has('space-1')).toBe(true);
    });

    it('should increment global event count', () => {
      const state = createInitialState();
      const event: PortalSseEvent = {
        event_kind: 'proofcomm_space',
        client_id: 'client-1',
        ts: 1704067200000,
        request_id: 'req-1',
        metadata: { action: 'message' },
      };

      applyEvent(state, event);
      applyEvent(state, { ...event, request_id: 'req-2' });
      applyEvent(state, { ...event, request_id: 'req-3' });

      expect(state.eventCount).toBe(3);
    });
  });
});

describe('ProofPortal routes', () => {
  // Note: Full route testing requires Fastify server setup.
  // These tests verify the route registration function exists and has correct exports.

  describe('registerPortalRoutes', () => {
    it('should be exported from index', async () => {
      const { registerPortalRoutes } = await import('../index.js');
      expect(typeof registerPortalRoutes).toBe('function');
    });
  });

  describe('PortalRoutesOptions', () => {
    it('should allow basePath option', async () => {
      const { registerPortalRoutes } = await import('../routes.js');

      // Mock Fastify instance
      const routes: Array<{ method: string; path: string }> = [];
      const mockFastify = {
        get: (path: string, _handler: unknown) => {
          routes.push({ method: 'GET', path });
        },
      };

      registerPortalRoutes(mockFastify as never, { basePath: '/custom-portal' });

      expect(routes).toContainEqual({ method: 'GET', path: '/custom-portal' });
      expect(routes).toContainEqual({ method: 'GET', path: '/custom-portal/' });
      expect(routes).toContainEqual({ method: 'GET', path: '/custom-portal/api/status' });
    });

    it('should use default basePath /portal', async () => {
      const { registerPortalRoutes } = await import('../routes.js');

      const routes: Array<{ method: string; path: string }> = [];
      const mockFastify = {
        get: (path: string, _handler: unknown) => {
          routes.push({ method: 'GET', path });
        },
      };

      registerPortalRoutes(mockFastify as never);

      expect(routes).toContainEqual({ method: 'GET', path: '/portal' });
      expect(routes).toContainEqual({ method: 'GET', path: '/portal/' });
      expect(routes).toContainEqual({ method: 'GET', path: '/portal/api/status' });
    });
  });
});
