/**
 * ProofComm Events tests
 * Phase 0: G1 - metadata_json contract tests
 */

import { describe, it, expect } from 'vitest';
import {
  type ProofCommMetadata,
  type ProofCommAction,
  truncatePreview,
  extractMessageText,
  createMessagePreview,
  isProofCommEventKind,
  isValidAction,
} from '../events.js';

describe('ProofComm Events - G1 Contract', () => {
  describe('Metadata Serialization', () => {
    it('should serialize metadata to valid JSON string', () => {
      const metadata: ProofCommMetadata = {
        action: 'created',
        space_id: 'test-space-123',
        space_name: 'Test Space',
      };

      const jsonString = JSON.stringify(metadata);
      expect(typeof jsonString).toBe('string');
      expect(() => JSON.parse(jsonString)).not.toThrow();
    });

    it('should round-trip metadata through JSON', () => {
      const metadata: ProofCommMetadata = {
        action: 'message',
        space_id: 'space-1',
        agent_id: 'agent-1',
        message_preview: 'Hello world',
        recipient_count: 5,
      };

      const jsonString = JSON.stringify(metadata);
      const parsed = JSON.parse(jsonString) as ProofCommMetadata;

      expect(parsed.action).toBe('message');
      expect(parsed.space_id).toBe('space-1');
      expect(parsed.agent_id).toBe('agent-1');
      expect(parsed.message_preview).toBe('Hello world');
      expect(parsed.recipient_count).toBe(5);
    });

    it('should handle all action types', () => {
      const actions: ProofCommAction[] = [
        'created',
        'joined',
        'left',
        'message',
        'delivery_failed',
        'search',
        'match',
        'activated',
        'context_updated',
        'resolved',
        'dispatched',
      ];

      for (const action of actions) {
        const metadata: ProofCommMetadata = { action };
        const jsonString = JSON.stringify(metadata);
        const parsed = JSON.parse(jsonString) as ProofCommMetadata;
        expect(parsed.action).toBe(action);
      }
    });

    it('should handle empty optional fields', () => {
      const metadata: ProofCommMetadata = {
        action: 'search',
      };

      const jsonString = JSON.stringify(metadata);
      const parsed = JSON.parse(jsonString) as ProofCommMetadata;

      expect(parsed.action).toBe('search');
      expect(parsed.space_id).toBeUndefined();
      expect(parsed.agent_id).toBeUndefined();
    });

    it('should handle special characters in strings', () => {
      const metadata: ProofCommMetadata = {
        action: 'message',
        message_preview: 'Hello "world" with\nnewlines and\ttabs',
        space_name: "Test's Space",
      };

      const jsonString = JSON.stringify(metadata);
      expect(() => JSON.parse(jsonString)).not.toThrow();

      const parsed = JSON.parse(jsonString) as ProofCommMetadata;
      expect(parsed.message_preview).toContain('\n');
      expect(parsed.message_preview).toContain('\t');
      expect(parsed.space_name).toContain("'");
    });

    it('should handle Unicode characters', () => {
      const metadata: ProofCommMetadata = {
        action: 'message',
        message_preview: 'こんにちは世界 🌍',
        space_name: '日本語スペース',
      };

      const jsonString = JSON.stringify(metadata);
      const parsed = JSON.parse(jsonString) as ProofCommMetadata;

      expect(parsed.message_preview).toBe('こんにちは世界 🌍');
      expect(parsed.space_name).toBe('日本語スペース');
    });
  });

  describe('Event Kind Validation', () => {
    it('should recognize valid ProofComm event kinds', () => {
      expect(isProofCommEventKind('proofcomm_space')).toBe(true);
      expect(isProofCommEventKind('proofcomm_skill')).toBe(true);
      expect(isProofCommEventKind('proofcomm_document')).toBe(true);
      expect(isProofCommEventKind('proofcomm_route')).toBe(true);
    });

    it('should reject invalid event kinds', () => {
      expect(isProofCommEventKind('gateway_auth_success')).toBe(false);
      expect(isProofCommEventKind('proofcomm_invalid')).toBe(false);
      expect(isProofCommEventKind('')).toBe(false);
      expect(isProofCommEventKind('random')).toBe(false);
    });
  });

  describe('Action Validation', () => {
    it('should validate space actions', () => {
      expect(isValidAction('proofcomm_space', 'created')).toBe(true);
      expect(isValidAction('proofcomm_space', 'joined')).toBe(true);
      expect(isValidAction('proofcomm_space', 'left')).toBe(true);
      expect(isValidAction('proofcomm_space', 'message')).toBe(true);
      expect(isValidAction('proofcomm_space', 'delivery_failed')).toBe(true);
      expect(isValidAction('proofcomm_space', 'search')).toBe(false);
    });

    it('should validate skill actions', () => {
      expect(isValidAction('proofcomm_skill', 'search')).toBe(true);
      expect(isValidAction('proofcomm_skill', 'match')).toBe(true);
      expect(isValidAction('proofcomm_skill', 'created')).toBe(false);
    });

    it('should validate document actions', () => {
      expect(isValidAction('proofcomm_document', 'activated')).toBe(true);
      expect(isValidAction('proofcomm_document', 'context_updated')).toBe(true);
      expect(isValidAction('proofcomm_document', 'message')).toBe(false);
    });

    it('should validate route actions', () => {
      expect(isValidAction('proofcomm_route', 'resolved')).toBe(true);
      expect(isValidAction('proofcomm_route', 'dispatched')).toBe(true);
      expect(isValidAction('proofcomm_route', 'search')).toBe(false);
    });
  });
});

describe('Message Preview Utilities', () => {
  describe('truncatePreview', () => {
    it('should not truncate short text', () => {
      expect(truncatePreview('Hello', 100)).toBe('Hello');
      expect(truncatePreview('Short message', 100)).toBe('Short message');
    });

    it('should truncate long text with ellipsis', () => {
      const longText = 'a'.repeat(150);
      const truncated = truncatePreview(longText, 100);
      expect(truncated).toHaveLength(100);
      expect(truncated).toMatch(/\.\.\.$/);
    });

    it('should handle exact length', () => {
      const exactText = 'a'.repeat(100);
      expect(truncatePreview(exactText, 100)).toBe(exactText);
    });

    it('should use default length of 100', () => {
      const longText = 'a'.repeat(150);
      const truncated = truncatePreview(longText);
      expect(truncated).toHaveLength(100);
    });
  });

  describe('extractMessageText', () => {
    it('should extract text from text parts', () => {
      const parts = [{ text: 'Hello' }, { text: 'World' }];
      expect(extractMessageText(parts)).toBe('Hello World');
    });

    it('should ignore non-text parts', () => {
      const parts = [
        { text: 'Hello' },
        { data: 'base64data', mimeType: 'image/png' },
        { text: 'World' },
      ];
      expect(extractMessageText(parts)).toBe('Hello World');
    });

    it('should handle empty parts', () => {
      expect(extractMessageText([])).toBe('');
    });

    it('should handle parts with only data', () => {
      const parts = [{ data: 'base64data', mimeType: 'image/png' }];
      expect(extractMessageText(parts)).toBe('');
    });
  });

  describe('createMessagePreview', () => {
    it('should create preview from message parts', () => {
      const parts = [{ text: 'Hello World' }];
      expect(createMessagePreview(parts, 100)).toBe('Hello World');
    });

    it('should truncate long messages', () => {
      const longText = 'a'.repeat(150);
      const parts = [{ text: longText }];
      const preview = createMessagePreview(parts, 100);
      expect(preview).toHaveLength(100);
      expect(preview).toMatch(/\.\.\.$/);
    });

    it('should concatenate multiple text parts', () => {
      const parts = [{ text: 'Part 1' }, { text: 'Part 2' }];
      expect(createMessagePreview(parts)).toBe('Part 1 Part 2');
    });
  });
});
