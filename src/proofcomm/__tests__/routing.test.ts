/**
 * ProofComm Routing tests
 * Phase 0: G2 - Reserved Namespace tests
 */

import { describe, it, expect } from 'vitest';
import {
  RESERVED_PREFIXES,
  VALID_ID_PATTERN,
  SKILL_ROUTE_PREFIX,
  parseAgentField,
  hasReservedPrefix,
  validateTargetId,
  validateIdFormat,
  validateTargetIdForRegistration,
  buildDocumentRoute,
  buildSpaceRoute,
  buildSkillRoute,
  RoutingError,
  isDocumentTarget,
  isSpaceTarget,
  isAgentTarget,
  isSkillTarget,
  usesFutureNamespace,
  parseFutureNamespace,
} from '../routing.js';

describe('ProofComm Routing - G2 Contract', () => {
  describe('Reserved Prefixes', () => {
    it('should define doc/ and space/ as reserved', () => {
      expect(RESERVED_PREFIXES).toContain('doc/');
      expect(RESERVED_PREFIXES).toContain('space/');
      expect(RESERVED_PREFIXES).toHaveLength(2);
    });

    it('should detect reserved prefix in strings', () => {
      expect(hasReservedPrefix('doc/abc123')).toBe(true);
      expect(hasReservedPrefix('space/xyz789')).toBe(true);
      expect(hasReservedPrefix('agent-1')).toBe(false);
      expect(hasReservedPrefix('https://example.com')).toBe(false);
    });
  });

  describe('ID Format Validation', () => {
    it('should accept valid IDs', () => {
      expect(validateIdFormat('abc123')).toBe(true);
      expect(validateIdFormat('test-agent')).toBe(true);
      expect(validateIdFormat('my_document')).toBe(true);
      expect(validateIdFormat('ABC123')).toBe(true);
      expect(validateIdFormat('a-b_c-1')).toBe(true);
    });

    it('should reject invalid IDs', () => {
      expect(validateIdFormat('')).toBe(false);
      expect(validateIdFormat('has space')).toBe(false);
      expect(validateIdFormat('has/slash')).toBe(false);
      expect(validateIdFormat('has.dot')).toBe(false);
      expect(validateIdFormat('has:colon')).toBe(false);
      expect(validateIdFormat('日本語')).toBe(false);
    });
  });

  describe('parseAgentField', () => {
    describe('Document routing', () => {
      it('should parse doc/ prefix', () => {
        const result = parseAgentField('doc/abc123');
        expect(result.type).toBe('document');
        expect(result.id).toBe('abc123');
        expect(result.original).toBe('doc/abc123');
      });

      it('should parse doc/ with complex ID', () => {
        const result = parseAgentField('doc/my-document_v2');
        expect(result.type).toBe('document');
        expect(result.id).toBe('my-document_v2');
      });

      it('should throw for empty doc ID', () => {
        expect(() => parseAgentField('doc/')).toThrow(RoutingError);
        expect(() => parseAgentField('doc/')).toThrow('Empty document ID');
      });

      it('should throw for invalid doc ID format', () => {
        expect(() => parseAgentField('doc/has space')).toThrow(RoutingError);
        expect(() => parseAgentField('doc/has/slash')).toThrow(RoutingError);
        expect(() => parseAgentField('doc/日本語')).toThrow(RoutingError);
      });
    });

    describe('Space routing', () => {
      it('should parse space/ prefix', () => {
        const result = parseAgentField('space/xyz789');
        expect(result.type).toBe('space');
        expect(result.id).toBe('xyz789');
        expect(result.original).toBe('space/xyz789');
      });

      it('should parse space/ with complex ID', () => {
        const result = parseAgentField('space/research-lab_01');
        expect(result.type).toBe('space');
        expect(result.id).toBe('research-lab_01');
      });

      it('should throw for empty space ID', () => {
        expect(() => parseAgentField('space/')).toThrow(RoutingError);
        expect(() => parseAgentField('space/')).toThrow('Empty space ID');
      });

      it('should throw for invalid space ID format', () => {
        expect(() => parseAgentField('space/has space')).toThrow(RoutingError);
        expect(() => parseAgentField('space/has.dot')).toThrow(RoutingError);
      });
    });

    describe('Regular agent routing', () => {
      it('should handle regular agent IDs', () => {
        const result = parseAgentField('agent-123');
        expect(result.type).toBe('agent');
        expect(result.id).toBe('agent-123');
        expect(result.original).toBe('agent-123');
      });

      it('should handle agent URLs', () => {
        const result = parseAgentField('https://example.com/agent');
        expect(result.type).toBe('agent');
        expect(result.id).toBe('https://example.com/agent');
      });

      it('should not misparse similar prefixes', () => {
        // "document" shouldn't be parsed as doc/
        const result1 = parseAgentField('document-agent');
        expect(result1.type).toBe('agent');
        expect(result1.id).toBe('document-agent');

        // "spaceship" shouldn't be parsed as space/
        const result2 = parseAgentField('spaceship');
        expect(result2.type).toBe('agent');
        expect(result2.id).toBe('spaceship');
      });
    });
  });

  describe('validateTargetId', () => {
    it('should accept IDs without reserved prefixes', () => {
      expect(validateTargetId('agent-123')).toBe(true);
      expect(validateTargetId('my-connector')).toBe(true);
      expect(validateTargetId('ABC123')).toBe(true);
    });

    it('should reject IDs with reserved prefixes', () => {
      expect(validateTargetId('doc/abc')).toBe(false);
      expect(validateTargetId('space/xyz')).toBe(false);
    });
  });

  describe('validateTargetIdForRegistration', () => {
    it('should accept valid IDs', () => {
      const result = validateTargetIdForRegistration('agent-123');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject empty IDs', () => {
      const result = validateTargetIdForRegistration('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject reserved prefixes', () => {
      const result = validateTargetIdForRegistration('doc/bad');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved prefix');
    });

    it('should reject invalid format', () => {
      const result = validateTargetIdForRegistration('has space');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('pattern');
    });
  });

  describe('Route Building', () => {
    it('should build document routes', () => {
      expect(buildDocumentRoute('abc123')).toBe('doc/abc123');
      expect(buildDocumentRoute('my-doc')).toBe('doc/my-doc');
    });

    it('should throw for invalid document IDs', () => {
      expect(() => buildDocumentRoute('has space')).toThrow(RoutingError);
      expect(() => buildDocumentRoute('')).toThrow(RoutingError);
    });

    it('should build space routes', () => {
      expect(buildSpaceRoute('xyz789')).toBe('space/xyz789');
      expect(buildSpaceRoute('my-space')).toBe('space/my-space');
    });

    it('should throw for invalid space IDs', () => {
      expect(() => buildSpaceRoute('has/slash')).toThrow(RoutingError);
      expect(() => buildSpaceRoute('')).toThrow(RoutingError);
    });
  });

  describe('Type Guards', () => {
    it('should identify document targets', () => {
      const docTarget = parseAgentField('doc/abc');
      expect(isDocumentTarget(docTarget)).toBe(true);
      expect(isSpaceTarget(docTarget)).toBe(false);
      expect(isAgentTarget(docTarget)).toBe(false);
    });

    it('should identify space targets', () => {
      const spaceTarget = parseAgentField('space/xyz');
      expect(isDocumentTarget(spaceTarget)).toBe(false);
      expect(isSpaceTarget(spaceTarget)).toBe(true);
      expect(isAgentTarget(spaceTarget)).toBe(false);
    });

    it('should identify agent targets', () => {
      const agentTarget = parseAgentField('agent-123');
      expect(isDocumentTarget(agentTarget)).toBe(false);
      expect(isSpaceTarget(agentTarget)).toBe(false);
      expect(isAgentTarget(agentTarget)).toBe(true);
    });
  });

  describe('RoutingError', () => {
    it('should have correct error properties', () => {
      const error = new RoutingError('Test error', 'INVALID_DOC_ID');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('INVALID_DOC_ID');
      expect(error.name).toBe('RoutingError');
    });
  });

  describe('Future Namespace (Reserved)', () => {
    it('should detect future namespace format', () => {
      expect(usesFutureNamespace('pc:doc:abc')).toBe(true);
      expect(usesFutureNamespace('pc:space:xyz')).toBe(true);
      expect(usesFutureNamespace('doc/abc')).toBe(false);
      expect(usesFutureNamespace('agent-123')).toBe(false);
    });

    it('should parse future namespace format', () => {
      const docResult = parseFutureNamespace('pc:doc:abc123');
      expect(docResult).not.toBeNull();
      expect(docResult?.type).toBe('document');
      expect(docResult?.id).toBe('abc123');

      const spaceResult = parseFutureNamespace('pc:space:xyz789');
      expect(spaceResult).not.toBeNull();
      expect(spaceResult?.type).toBe('space');
      expect(spaceResult?.id).toBe('xyz789');
    });

    it('should return null for non-future namespace', () => {
      expect(parseFutureNamespace('doc/abc')).toBeNull();
      expect(parseFutureNamespace('agent-123')).toBeNull();
    });

    it('should return null for invalid future namespace format', () => {
      expect(parseFutureNamespace('pc:invalid')).toBeNull();
      expect(parseFutureNamespace('pc:unknown:abc')).toBeNull();
    });
  });
});

describe('Integration: G2 Registration Flow', () => {
  it('should validate and reject reserved prefixes on registration', () => {
    // Simulate registration flow
    const testCases = [
      { id: 'valid-agent', shouldPass: true },
      { id: 'doc/invalid', shouldPass: false },
      { id: 'space/invalid', shouldPass: false },
      { id: 'document-agent', shouldPass: true },
      { id: 'spaceship-agent', shouldPass: true },
    ];

    for (const { id, shouldPass } of testCases) {
      const result = validateTargetIdForRegistration(id);
      expect(result.valid).toBe(shouldPass);
    }
  });

  it('should parse and route correctly', () => {
    // Simulate routing flow
    const testCases = [
      { agent: 'doc/my-doc', expectedType: 'document' },
      { agent: 'space/my-space', expectedType: 'space' },
      { agent: '@skill:translate', expectedType: 'skill' },
      { agent: 'agent-123', expectedType: 'agent' },
      { agent: 'https://example.com/agent', expectedType: 'agent' },
    ];

    for (const { agent, expectedType } of testCases) {
      const result = parseAgentField(agent);
      expect(result.type).toBe(expectedType);
    }
  });
});

// ==================== Phase 9.2: Skill Routing ====================

describe('Skill Routing - Phase 9.2', () => {
  describe('SKILL_ROUTE_PREFIX', () => {
    it('should be @skill:', () => {
      expect(SKILL_ROUTE_PREFIX).toBe('@skill:');
    });
  });

  describe('parseAgentField - @skill: prefix', () => {
    it('should parse @skill:translate as skill target', () => {
      const result = parseAgentField('@skill:translate');
      expect(result.type).toBe('skill');
      expect(result.id).toBe('translate');
      expect(result.original).toBe('@skill:translate');
    });

    it('should parse @skill:text-translation as skill target', () => {
      const result = parseAgentField('@skill:text-translation');
      expect(result.type).toBe('skill');
      expect(result.id).toBe('text-translation');
    });

    it('should parse @skill:summarize as skill target', () => {
      const result = parseAgentField('@skill:summarize');
      expect(result.type).toBe('skill');
      expect(result.id).toBe('summarize');
    });

    it('should throw RoutingError for empty skill name', () => {
      expect(() => parseAgentField('@skill:')).toThrow(RoutingError);
      expect(() => parseAgentField('@skill:')).toThrow('Empty skill name');
    });

    it('should not confuse @skill: with doc/ or space/', () => {
      expect(parseAgentField('doc/abc').type).toBe('document');
      expect(parseAgentField('space/abc').type).toBe('space');
      expect(parseAgentField('@skill:abc').type).toBe('skill');
    });
  });

  describe('buildSkillRoute', () => {
    it('should build @skill: prefix route', () => {
      expect(buildSkillRoute('translate')).toBe('@skill:translate');
      expect(buildSkillRoute('summarize')).toBe('@skill:summarize');
    });

    it('should throw for empty skill name', () => {
      expect(() => buildSkillRoute('')).toThrow(RoutingError);
    });
  });

  describe('isSkillTarget', () => {
    it('should return true for skill target', () => {
      expect(isSkillTarget({ type: 'skill', id: 'translate', original: '@skill:translate' })).toBe(true);
    });

    it('should return false for non-skill targets', () => {
      expect(isSkillTarget({ type: 'agent', id: 'agent-1', original: 'agent-1' })).toBe(false);
      expect(isSkillTarget({ type: 'document', id: 'doc-1', original: 'doc/doc-1' })).toBe(false);
      expect(isSkillTarget({ type: 'space', id: 'space-1', original: 'space/space-1' })).toBe(false);
    });
  });
});
