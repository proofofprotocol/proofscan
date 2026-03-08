/**
 * Tests for ProofComm Proxy skill endpoints
 * Phase 9.2: Skill Routing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { SpacesStore } from '../../db/spaces-store.js';
import * as guildModule from '../../proofcomm/guild/index.js';

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

describe('ProofComm Proxy - Space Endpoints', () => {
  let server: FastifyInstance;
  let configDir: string;
  let targetsStore: TargetsStore;

  beforeEach(async () => {
    // Create temp config directory
    configDir = await mkdtemp(join(tmpdir(), 'pfscan-proofcomm-space-test-'));

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

  describe('POST /proofcomm/spaces', () => {
    it('should create a new space', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          name: 'Test Space',
          visibility: 'public',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.space_id).toBeDefined();
      expect(body.name).toBe('Test Space');
      expect(body.visibility).toBe('public');
      expect(body.route).toMatch(/^space\//);
    });

    it('should create a space with all optional fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          name: 'Full Space',
          description: 'A test space',
          visibility: 'private',
          portal_visible: false,
          creator_agent_id: 'test-agent',
          config: { theme: 'dark' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.description).toBe('A test space');
      expect(body.visibility).toBe('private');
      expect(body.portal_visible).toBe(false);
      expect(body.creator_agent_id).toBe('test-agent');
    });

    it('should auto-join creator as moderator', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          name: 'Creator Space',
          visibility: 'public',
          creator_agent_id: 'test-agent',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);

      // Check that creator is a member
      const membersResponse = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${body.space_id}/members`,
      });

      const membersBody = JSON.parse(membersResponse.payload);
      expect(membersBody.members).toHaveLength(1);
      expect(membersBody.members[0].agent_id).toBe('test-agent');
      expect(membersBody.members[0].role).toBe('moderator');
    });

    it('should require name field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          visibility: 'public',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require visibility field', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          name: 'No Visibility',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid visibility value', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          name: 'Bad Visibility',
          visibility: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /proofcomm/spaces', () => {
    it('should return empty list when no spaces exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/spaces',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.spaces).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('should return all spaces', async () => {
      // Create two spaces
      await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Space 1', visibility: 'public' },
      });
      await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Space 2', visibility: 'private' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/spaces',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.count).toBe(2);
      expect(body.spaces.map((s: { name: string }) => s.name)).toContain('Space 1');
      expect(body.spaces.map((s: { name: string }) => s.name)).toContain('Space 2');
    });

    it('should filter by visibility', async () => {
      await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Public Space', visibility: 'public' },
      });
      await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Private Space', visibility: 'private' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/spaces?visibility=public',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.count).toBe(1);
      expect(body.spaces[0].name).toBe('Public Space');
    });

    it('should include member_count in response', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          name: 'Space with Members',
          visibility: 'public',
          creator_agent_id: 'test-agent',
        },
      });
      const createBody = JSON.parse(createResponse.payload);

      // Join another agent
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${createBody.space_id}/join`,
        payload: { agent_id: 'another-agent' },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/spaces',
      });

      const body = JSON.parse(response.payload);
      expect(body.spaces[0].member_count).toBe(2);
    });
  });

  describe('GET /proofcomm/spaces/:space_id', () => {
    it('should return space details', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: {
          name: 'Detail Space',
          description: 'Test description',
          visibility: 'public',
        },
      });
      const createBody = JSON.parse(createResponse.payload);

      const response = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${createBody.space_id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.space_id).toBe(createBody.space_id);
      expect(body.name).toBe('Detail Space');
      expect(body.description).toBe('Test description');
      expect(body.member_count).toBe(0);
    });

    it('should return 404 for non-existent space', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('SPACE_NOT_FOUND');
    });
  });

  describe('PATCH /proofcomm/spaces/:space_id', () => {
    let spaceId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Update Test Space', visibility: 'public', description: 'Original' },
      });
      spaceId = JSON.parse(response.payload).space_id;
    });

    it('should update space name', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/proofcomm/spaces/${spaceId}`,
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('Updated Name');
      expect(body.description).toBe('Original'); // unchanged
    });

    it('should update multiple fields', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/proofcomm/spaces/${spaceId}`,
        payload: {
          name: 'New Name',
          description: 'New Description',
          portal_visible: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('New Name');
      expect(body.description).toBe('New Description');
      expect(body.portal_visible).toBe(false);
    });

    it('should return 400 for empty payload', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/proofcomm/spaces/${spaceId}`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('should return 404 for non-existent space', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV',
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('SPACE_NOT_FOUND');
    });
  });

  describe('POST /proofcomm/spaces/:space_id/join', () => {
    let spaceId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Join Test Space', visibility: 'public' },
      });
      spaceId = JSON.parse(response.payload).space_id;
    });

    it('should join an agent to a space', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.space_id).toBe(spaceId);
      expect(body.agent_id).toBe('test-agent');
      expect(body.joined).toBe(true);
    });

    it('should join with specified role', async () => {
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent', role: 'observer' },
      });

      const membersResponse = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${spaceId}/members`,
      });

      const body = JSON.parse(membersResponse.payload);
      expect(body.members[0].role).toBe('observer');
    });

    it('should return 409 if already a member', async () => {
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('ALREADY_MEMBER');
    });

    it('should return 404 for non-existent space', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/join',
        payload: { agent_id: 'test-agent' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require agent_id in body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /proofcomm/spaces/:space_id/leave', () => {
    let spaceId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Leave Test Space', visibility: 'public' },
      });
      spaceId = JSON.parse(response.payload).space_id;

      // Join an agent first
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });
    });

    it('should leave a space', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/leave`,
        payload: { agent_id: 'test-agent' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.left).toBe(true);
    });

    it('should return 409 if not a member', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/leave`,
        payload: { agent_id: 'another-agent' },
      });

      // 409 Conflict: authorized but operation conflicts with current state
      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('NOT_MEMBER');
    });

    it('should return 404 for non-existent space', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/leave',
        payload: { agent_id: 'test-agent' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should allow re-join after leave', async () => {
      // Leave
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/leave`,
        payload: { agent_id: 'test-agent' },
      });

      // Re-join
      const response = await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).joined).toBe(true);
    });
  });

  describe('GET /proofcomm/spaces/:space_id/members', () => {
    let spaceId: string;

    beforeEach(async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Members Test Space', visibility: 'public' },
      });
      spaceId = JSON.parse(response.payload).space_id;
    });

    it('should return empty list when no members', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${spaceId}/members`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.members).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('should return all members', async () => {
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent', role: 'moderator' },
      });
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'another-agent', role: 'member' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${spaceId}/members`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.count).toBe(2);
      expect(body.members.map((m: { agent_id: string }) => m.agent_id)).toContain('test-agent');
      expect(body.members.map((m: { agent_id: string }) => m.agent_id)).toContain('another-agent');
    });

    it('should filter out left members by default', async () => {
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/leave`,
        payload: { agent_id: 'test-agent' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${spaceId}/members`,
      });

      const body = JSON.parse(response.payload);
      expect(body.count).toBe(0);
    });

    it('should include left members when active_only=false', async () => {
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/leave`,
        payload: { agent_id: 'test-agent' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${spaceId}/members?active_only=false`,
      });

      const body = JSON.parse(response.payload);
      expect(body.count).toBe(1);
      expect(body.members[0].left_at).toBeDefined();
    });

    it('should return 404 for non-existent space', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/members',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /proofcomm/spaces/:space_id', () => {
    it('should delete a space', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Delete Test Space', visibility: 'public' },
      });
      const spaceId = JSON.parse(createResponse.payload).space_id;

      const response = await server.inject({
        method: 'DELETE',
        url: `/proofcomm/spaces/${spaceId}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify space is gone
      const getResponse = await server.inject({
        method: 'GET',
        url: `/proofcomm/spaces/${spaceId}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('should cascade delete memberships', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Cascade Delete Space', visibility: 'public' },
      });
      const spaceId = JSON.parse(createResponse.payload).space_id;

      // Add members
      await server.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });

      // Delete space
      const response = await server.inject({
        method: 'DELETE',
        url: `/proofcomm/spaces/${spaceId}`,
      });

      expect(response.statusCode).toBe(204);
    });

    it('should return 404 for non-existent space', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Permission checks', () => {
    let restrictedServer: FastifyInstance;

    beforeEach(async () => {
      restrictedServer = Fastify();

      restrictedServer.addHook('onRequest', async (request) => {
        request.requestId = 'test-request-id';
      });

      // Auth with limited permissions
      restrictedServer.addHook('preHandler', async (request) => {
        (request as unknown as { auth: AuthInfo }).auth = {
          client_id: 'restricted-client',
          permissions: ['proofcomm:skills:read'], // No spaces permissions
        };
      });

      const auditLogger = createAuditLogger(configDir);
      registerProofCommRoutes(restrictedServer, {
        configDir,
        auditLogger,
      });

      await restrictedServer.ready();
    });

    afterEach(async () => {
      await restrictedServer.close();
    });

    it('should return 403 for create without permission', async () => {
      const response = await restrictedServer.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Forbidden', visibility: 'public' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should return 403 for list without permission', async () => {
      const response = await restrictedServer.inject({
        method: 'GET',
        url: '/proofcomm/spaces',
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 403 for join without permission', async () => {
      // First create a space with full permissions
      const createResponse = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces',
        payload: { name: 'Restricted Join', visibility: 'public' },
      });
      const spaceId = JSON.parse(createResponse.payload).space_id;

      // Try to join with restricted permissions
      const response = await restrictedServer.inject({
        method: 'POST',
        url: `/proofcomm/spaces/${spaceId}/join`,
        payload: { agent_id: 'test-agent' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /proofcomm/spaces/:space_id/broadcast', () => {
    it('should return 401 without authorization header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/broadcast',
        payload: {
          message: { parts: [{ text: 'Hello!' }] },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 with invalid token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/broadcast',
        headers: {
          authorization: 'Bearer invalid-token-12345',
        },
        payload: {
          message: { parts: [{ text: 'Hello!' }] },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe('INVALID_TOKEN');
    });

    // Schema validation tests: Fastify's ajv validates the request body BEFORE
    // the handler runs, so 400 is returned before the auth check. The token
    // value doesn't matter here because the request never reaches the handler.
    it('should return 400 with invalid message format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/broadcast',
        headers: {
          authorization: 'Bearer some-token',
        },
        payload: {
          message: { invalid: 'format' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 with empty parts array', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/proofcomm/spaces/01ARZ3NDEKTSV4RRFFQ69G5FAV/broadcast',
        headers: {
          authorization: 'Bearer some-token',
        },
        payload: {
          message: { parts: [] },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    describe('with valid guild token', () => {
      let spacesStore: SpacesStore;
      let testSpaceId: string;
      const testAgentId = 'test-guild-agent';
      const validToken = 'valid-test-token-12345';

      beforeEach(() => {
        // Mock validateGuildToken to return our test agent ID
        vi.spyOn(guildModule, 'validateGuildToken').mockImplementation((token: string) => {
          if (token === validToken) {
            return testAgentId;
          }
          return null;
        });

        // Set up spaces store and create a test space
        spacesStore = new SpacesStore(configDir);
        const space = spacesStore.create({
          name: 'Test Broadcast Space',
          visibility: 'private',
          creatorAgentId: testAgentId,
        });
        testSpaceId = space.spaceId;
        // Add the test agent as a member (SpacesStore.create doesn't auto-join)
        spacesStore.join(testSpaceId, testAgentId, 'moderator');
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('should return 200 for successful broadcast', async () => {
        const response = await server.inject({
          method: 'POST',
          url: `/proofcomm/spaces/${testSpaceId}/broadcast`,
          headers: {
            authorization: `Bearer ${validToken}`,
          },
          payload: {
            message: { parts: [{ text: 'Hello space members!' }] },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('delivered');
        expect(body).toHaveProperty('failed');
        expect(body).toHaveProperty('recipient_count');
        expect(body).toHaveProperty('message_id');
      });

      it('should return 404 when space does not exist', async () => {
        const nonExistentSpaceId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
        const response = await server.inject({
          method: 'POST',
          url: `/proofcomm/spaces/${nonExistentSpaceId}/broadcast`,
          headers: {
            authorization: `Bearer ${validToken}`,
          },
          payload: {
            message: { parts: [{ text: 'Hello!' }] },
          },
        });

        expect(response.statusCode).toBe(404);
        const body = JSON.parse(response.payload);
        expect(body.error.code).toBe('SPACE_NOT_FOUND');
      });

      it('should return 403 when sender is not a space member', async () => {
        // Create a space owned by a different agent
        const otherSpace = spacesStore.create({
          name: 'Other Agent Space',
          visibility: 'private',
          creatorAgentId: 'other-agent-id',
        });

        const response = await server.inject({
          method: 'POST',
          url: `/proofcomm/spaces/${otherSpace.spaceId}/broadcast`,
          headers: {
            authorization: `Bearer ${validToken}`,
          },
          payload: {
            message: { parts: [{ text: 'Hello!' }] },
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.payload);
        expect(body.error.code).toBe('NOT_MEMBER');
      });
    });
  });
});
