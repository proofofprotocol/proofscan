/**
 * Tests for ProofComm Proxy skill endpoints
 * Phase 9.2: Skill Routing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerProofCommRoutes } from '../proofcommProxy.js';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import type { AuthInfo } from '../authMiddleware.js';
import { TargetsStore } from '../../db/targets-store.js';
import { SkillsStore } from '../../db/skills-store.js';
import { createAuditLogger } from '../audit.js';
import { closeAllDbs } from '../../db/connection.js';

describe('ProofComm Proxy - Skill Endpoints', () => {
  let server: FastifyInstance;
  let configDir: string;
  let targetsStore: TargetsStore;
  let skillsStore: SkillsStore;

  beforeEach(async () => {
    // Create temp config directory
    configDir = await mkdtemp(join(tmpdir(), 'pfscan-proofcomm-test-'));

    // Initialize targets store and add test agents
    targetsStore = new TargetsStore(configDir);
    targetsStore.add({
      type: 'agent',
      protocol: 'a2a',
      name: 'Test Agent',
      enabled: true,
      config: { url: 'http://localhost:3001' },
    }, { id: 'test-agent' });

    targetsStore.add({
      type: 'agent',
      protocol: 'a2a',
      name: 'Another Agent',
      enabled: true,
      config: { url: 'http://localhost:3002' },
    }, { id: 'another-agent' });

    // Initialize skills store
    skillsStore = new SkillsStore(configDir);

    // Create Fastify server
    server = Fastify();

    // Add request ID
    server.addHook('onRequest', async (request) => {
      request.requestId = 'test-request-id';
    });

    // Add mock auth
    server.addHook('preHandler', async (request) => {
      (request as unknown as { auth: AuthInfo }).auth = {
        client_id: 'test-client',
        permissions: ['proofcomm:*'],
      };
    });

    // Create audit logger
    const auditLogger = createAuditLogger(configDir);

    // Register ProofComm routes
    registerProofCommRoutes(server, {
      configDir,
      auditLogger,
    });

    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    closeAllDbs();
    await rm(configDir, { recursive: true });
  });

  describe('GET /proofcomm/skills', () => {
    it('should return empty list when no skills cached', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/skills',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.skills).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('should return all cached skills', async () => {
      // Add skills
      skillsStore.upsertMany('test-agent', [
        { name: 'translate', description: 'Translation' },
        { name: 'summarize', description: 'Summarization' },
      ]);

      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/skills',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.count).toBe(2);
      expect(body.skills.map((s: { name: string }) => s.name)).toContain('translate');
      expect(body.skills.map((s: { name: string }) => s.name)).toContain('summarize');
    });

    it('should filter by agent_id', async () => {
      // Add skills for multiple agents
      skillsStore.upsertMany('test-agent', [
        { name: 'translate', description: 'Translation' },
      ]);
      skillsStore.upsertMany('another-agent', [
        { name: 'analyze', description: 'Analysis' },
      ]);

      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/skills?agent_id=test-agent',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.count).toBe(1);
      expect(body.skills[0].name).toBe('translate');
    });
  });

  describe('GET /proofcomm/skills/search', () => {
    beforeEach(() => {
      skillsStore.upsertMany('test-agent', [
        { name: 'translate', description: 'Translation service', tags: ['language'] },
        { name: 'summarize', description: 'Text summarization', tags: ['nlp', 'text'] },
      ]);
      skillsStore.upsertMany('another-agent', [
        { name: 'analyze', description: 'Data analysis', tags: ['data'] },
      ]);
    });

    it('should search by query string', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/skills/search?q=translate',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.count).toBeGreaterThan(0);
      expect(body.results[0].skill.name).toBe('translate');
    });

    it('should search by tags', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/skills/search?q=text&tags=nlp',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.count).toBeGreaterThan(0);
      expect(body.results[0].skill.name).toBe('summarize');
    });

    it('should require q parameter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/skills/search',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should respect limit parameter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/skills/search?q=a&limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('POST /proofcomm/skills/refresh/:agent_id', () => {
    it('should cache skills from agent card', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/skills/refresh/test-agent',
        payload: {
          agent_card: {
            name: 'Test Agent',
            skills: [
              { name: 'translate', description: 'Translation' },
              { name: 'summarize', description: 'Summarization' },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.agent_id).toBe('test-agent');
      expect(body.skills_cached).toBe(2);

      // Verify skills are cached
      const skills = skillsStore.list('test-agent');
      expect(skills.length).toBe(2);
    });

    it('should reject unregistered agent_id (cache poisoning protection)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/skills/refresh/unregistered-agent',
        payload: {
          agent_card: {
            name: 'Fake Agent',
            skills: [{ name: 'malicious-skill' }],
          },
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('AGENT_NOT_FOUND');
    });

    it('should require agent_card in body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/skills/refresh/test-agent',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should replace existing skills on refresh', async () => {
      // Initial skills
      skillsStore.upsertMany('test-agent', [
        { name: 'old-skill', description: 'Old' },
      ]);

      // Refresh with new skills
      await server.inject({
        method: 'POST',
        url: '/proofcomm/skills/refresh/test-agent',
        payload: {
          agent_card: {
            skills: [{ name: 'new-skill', description: 'New' }],
          },
        },
      });

      const skills = skillsStore.list('test-agent');
      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('new-skill');
    });
  });

  describe('DELETE /proofcomm/skills/:agent_id', () => {
    it('should delete all skills for an agent', async () => {
      skillsStore.upsertMany('test-agent', [
        { name: 'translate' },
        { name: 'summarize' },
      ]);

      const response = await server.inject({
        method: 'DELETE',
        url: '/proofcomm/skills/test-agent',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.agent_id).toBe('test-agent');
      expect(body.deleted).toBe(2);

      // Verify skills are gone
      expect(skillsStore.list('test-agent').length).toBe(0);
    });

    it('should return 0 for agent with no skills', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/proofcomm/skills/test-agent',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.deleted).toBe(0);
    });
  });

  describe('POST /proofcomm/skills/purge', () => {
    it('should purge expired skills', async () => {
      // Add a skill with immediate expiration
      skillsStore.upsert({
        agentId: 'test-agent',
        name: 'expired-skill',
        ttlSeconds: -1, // Already expired
      });

      // Add a non-expired skill
      skillsStore.upsert({
        agentId: 'test-agent',
        name: 'valid-skill',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/skills/purge',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.deleted).toBeGreaterThanOrEqual(1);

      // Valid skill should still exist
      const skills = skillsStore.list('test-agent');
      expect(skills.some(s => s.name === 'valid-skill')).toBe(true);
    });
  });
});
