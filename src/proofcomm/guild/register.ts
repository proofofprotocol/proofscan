/**
 * ProofGuild - Agent Registration (API Key Protected)
 * Phase 5: ProofGuild
 *
 * Allows external agents (OpenClaw, PicoClaw, etc.) to register
 * with the Guild using API key authentication.
 *
 * Security: Registration requires GUILD_API_KEY for authentication.
 */

import { randomBytes, createHmac } from 'crypto';
import { fetchAgentCard, type FetchAgentCardResult } from '../../a2a/agent-card.js';
import { TargetsStore, type TargetWithConfig } from '../../db/targets-store.js';
import { emitSpaceEvent, type ProofCommEventBaseOptions } from '../events.js';
import type { AuditLogger } from '../../gateway/audit.js';
import { ulid } from 'ulid';

// ============================================================================
// Types
// ============================================================================

/**
 * Request body for guild registration
 */
export interface GuildRegisterRequest {
  /** Agent base URL (AgentCard will be fetched from this URL) */
  url: string;
  /** Optional display name (defaults to AgentCard.name) */
  name?: string;
}

/**
 * Response for successful guild registration
 */
export interface GuildRegisterResponse {
  /** Registered agent ID */
  agent_id: string;
  /** Bearer token for subsequent API calls */
  token: string;
  /** Confirmed display name */
  name: string;
  /** Token expiration (ISO8601, optional) */
  expires_at?: string;
}

/**
 * Result of guild registration
 */
export interface GuildRegisterResult {
  ok: boolean;
  response?: GuildRegisterResponse;
  error?: string;
  statusCode?: number;
}

/**
 * Stored token entry
 */
interface TokenEntry {
  agentId: string;
  name: string;
  createdAt: string;
  expiresAt?: string;
}

// ============================================================================
// API Key Authentication
// ============================================================================

/**
 * API key for guild registration (required)
 */
const GUILD_API_KEY = process.env.GUILD_API_KEY;

/**
 * Validate API key from Authorization header
 * @returns true if valid, false otherwise
 */
export function validateApiKey(authHeader: string | undefined): boolean {
  if (!GUILD_API_KEY) {
    // No API key configured - reject all requests
    return false;
  }
  if (!authHeader) {
    return false;
  }
  // Expected format: "Bearer <key>"
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }
  return match[1] === GUILD_API_KEY;
}

/**
 * Check if API key is configured
 */
export function isApiKeyConfigured(): boolean {
  return !!GUILD_API_KEY;
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * In-memory token store - keyed by token hash for O(1) lookup
 * Note: This is lost on server restart. For production, consider persisting to DB.
 */
const guildTokensByHash = new Map<string, TokenEntry>();

/**
 * Secret for signing tokens (must be set via environment variable in production)
 */
const GUILD_TOKEN_SECRET = process.env.GUILD_TOKEN_SECRET || 'proofguild-dev-secret';

// Production check for token secret
if (!process.env.GUILD_TOKEN_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[ProofGuild] WARNING: GUILD_TOKEN_SECRET not set in production!');
}

/**
 * Generate a random token
 */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash a token for storage
 */
function hashToken(token: string): string {
  return createHmac('sha256', GUILD_TOKEN_SECRET)
    .update(token)
    .digest('hex');
}

/**
 * Validate a token and return the associated agent ID (O(1) lookup)
 */
export function validateGuildToken(token: string): string | null {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const entry = guildTokensByHash.get(tokenHash);

  if (!entry) {
    return null;
  }

  // Check expiration
  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    guildTokensByHash.delete(tokenHash);
    return null;
  }

  return entry.agentId;
}

/**
 * Get all registered guild tokens count (for debugging)
 */
export function getGuildTokenCount(): number {
  return guildTokensByHash.size;
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Simple in-memory rate limiter
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;

/**
 * Check if rate limit is exceeded
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// ============================================================================
// Registration Logic
// ============================================================================

export interface RegisterAgentOptions {
  /** Targets store instance */
  targetsStore: TargetsStore;
  /** Audit logger for event emission */
  auditLogger: AuditLogger;
  /** Client IP for rate limiting */
  clientIp: string;
  /** Base event options */
  baseOptions: Omit<ProofCommEventBaseOptions, 'target'>;
  /** Allow local URLs (development only) */
  allowLocal?: boolean;
}

/**
 * Register an external agent with the Guild
 *
 * Prerequisites: API key must be validated before calling this function.
 *
 * Flow:
 * 1. Rate limit check
 * 2. Fetch AgentCard from URL
 * 3. Register agent in targets store
 * 4. Generate and store token
 * 5. Emit 'registered' event
 * 6. Return token to agent
 */
export async function registerGuildAgent(
  request: GuildRegisterRequest,
  options: RegisterAgentOptions
): Promise<GuildRegisterResult> {
  const { targetsStore, auditLogger, clientIp, baseOptions, allowLocal } = options;

  // Rate limit check
  if (isRateLimited(clientIp)) {
    return {
      ok: false,
      error: 'Rate limit exceeded. Try again later.',
      statusCode: 429,
    };
  }

  // Validate URL
  if (!request.url || typeof request.url !== 'string') {
    return {
      ok: false,
      error: 'Missing required field: url',
      statusCode: 400,
    };
  }

  // Normalize URL
  const url = request.url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return {
      ok: false,
      error: 'Invalid URL: must start with http:// or https://',
      statusCode: 400,
    };
  }

  // Fetch AgentCard
  const cardResult: FetchAgentCardResult = await fetchAgentCard(url, {
    allowLocal,
    timeout: 10_000,
  });

  if (!cardResult.ok || !cardResult.agentCard) {
    return {
      ok: false,
      error: cardResult.error || 'Failed to fetch AgentCard',
      statusCode: 422,
    };
  }

  const agentCard = cardResult.agentCard;
  const agentName = request.name || agentCard.name;

  // Check if agent is already registered (by URL)
  const existingTargets = targetsStore.list({ type: 'agent' });
  for (const target of existingTargets) {
    const config = target.config as { url?: string } | undefined;
    if (config?.url === url) {
      return {
        ok: false,
        error: 'Agent already registered with this URL',
        statusCode: 409,
      };
    }
  }

  // Register agent in targets store
  const agentId = ulid();
  let target: TargetWithConfig;
  try {
    target = targetsStore.add({
      type: 'agent',
      protocol: 'a2a',
      name: agentName,
      enabled: true,
      config: {
        schema_version: 1,
        url,
        source: 'guild_register',
        registered_at: new Date().toISOString(),
      },
    }, { id: agentId });
  } catch (err) {
    return {
      ok: false,
      error: `Failed to register agent: ${err instanceof Error ? err.message : 'Unknown error'}`,
      statusCode: 500,
    };
  }

  // Generate token
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  // Store token by hash for O(1) lookup
  guildTokensByHash.set(tokenHash, {
    agentId,
    name: agentName,
    createdAt: now,
    // No expiration for MVP
  });

  // Emit 'registered' event
  emitSpaceEvent(
    auditLogger,
    'registered',
    {
      agent_id: agentId,
      agent_name: agentName,
    },
    {
      ...baseOptions,
      target: agentId,
    }
  );

  return {
    ok: true,
    response: {
      agent_id: agentId,
      token,
      name: agentName,
    },
  };
}

/**
 * Clean up expired tokens and old rate limit entries
 */
export function cleanupGuildTokens(): void {
  const now = Date.now();

  // Clean up expired tokens
  for (const [hash, entry] of guildTokensByHash) {
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) {
      guildTokensByHash.delete(hash);
    }
  }

  // Clean up old rate limit entries
  for (const [ip, entry] of rateLimitMap) {
    if (entry.resetAt < now) {
      rateLimitMap.delete(ip);
    }
  }
}

// Start periodic cleanup (every 5 minutes)
const cleanupInterval = setInterval(cleanupGuildTokens, 5 * 60 * 1000);
cleanupInterval.unref(); // Don't block process exit
