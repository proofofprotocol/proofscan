/**
 * ProofGuild - Agent Registration (API Key Protected)
 * Phase 5: ProofGuild
 *
 * Allows external agents (OpenClaw, PicoClaw, etc.) to register
 * with the Guild using API key authentication.
 *
 * Security: Registration requires GUILD_API_KEY for authentication.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
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
 * Validate API key from Authorization header using timing-safe comparison
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
  const providedKey = match[1];
  // Use timing-safe comparison to prevent timing attacks
  if (providedKey.length !== GUILD_API_KEY.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(providedKey, 'utf-8'),
    Buffer.from(GUILD_API_KEY, 'utf-8')
  );
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
function getTokenSecret(): string {
  const secret = process.env.GUILD_TOKEN_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[ProofGuild] GUILD_TOKEN_SECRET must be set in production');
    }
    return 'proofguild-dev-secret';
  }
  return secret;
}

const GUILD_TOKEN_SECRET = getTokenSecret();

/**
 * Token TTL in milliseconds (30 days)
 */
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
// SSRF Protection
// ============================================================================

/**
 * Private/internal IP ranges that should be blocked for SSRF protection
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // Loopback (127.0.0.0/8)
  /^10\./,                           // Private Class A (10.0.0.0/8)
  /^172\.(1[6-9]|2\d|3[01])\./,      // Private Class B (172.16.0.0/12)
  /^192\.168\./,                     // Private Class C (192.168.0.0/16)
  /^169\.254\./,                     // Link-local (169.254.0.0/16)
  /^0\./,                            // Current network (0.0.0.0/8)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // Carrier-grade NAT (100.64.0.0/10)
  /^192\.0\.0\./,                    // IETF Protocol Assignments (192.0.0.0/24)
  /^192\.0\.2\./,                    // TEST-NET-1 (192.0.2.0/24)
  /^198\.51\.100\./,                 // TEST-NET-2 (198.51.100.0/24)
  /^203\.0\.113\./,                  // TEST-NET-3 (203.0.113.0/24)
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
];

/**
 * Common localhost hostnames
 */
const LOCALHOST_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

/**
 * Check if a URL points to an internal/private address (SSRF protection)
 * @returns true if the URL is safe (external), false if internal
 */
export function isExternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Check localhost names
    if (LOCALHOST_HOSTNAMES.has(hostname)) {
      return false;
    }

    // Check private IP patterns
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return false;
      }
    }

    return true;
  } catch {
    // Invalid URL - treat as unsafe
    return false;
  }
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

  // SSRF protection: Block internal/private IP addresses (unless allowLocal is set)
  if (!allowLocal && !isExternalUrl(url)) {
    return {
      ok: false,
      error: 'Invalid URL: internal/private addresses are not allowed',
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

  // Generate token with TTL
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

  // Store token by hash for O(1) lookup
  guildTokensByHash.set(tokenHash, {
    agentId,
    name: agentName,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
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
      expires_at: expiresAt.toISOString(),
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
