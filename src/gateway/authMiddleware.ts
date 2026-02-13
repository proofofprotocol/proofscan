/**
 * Authentication middleware for Fastify
 * Phase 8.2: Bearer Token Authentication
 */

import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { AuthConfig, validateToken } from './auth.js';

/**
 * Authentication info attached to request
 */
export interface AuthInfo {
  /** Client identifier (token name) */
  client_id: string;
  /** Granted permissions */
  permissions: string[];
}

/**
 * Extend FastifyRequest to include auth info
 */
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthInfo;
  }
}

/**
 * Error response format
 */
interface AuthErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/** Paths that don't require authentication */
const PUBLIC_PATHS = ['/health'];

/**
 * Create authentication middleware
 * 
 * Behavior:
 * - Public paths (e.g., /health) → skip authentication
 * - mode: 'none' → skip authentication, attach empty auth
 * - mode: 'bearer' → require valid Bearer token
 * 
 * @param config Auth configuration
 * @returns Fastify preHandler hook
 */
export function createAuthMiddleware(
  config: AuthConfig
): preHandlerHookHandler {
  return async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    // Skip auth for public paths
    if (PUBLIC_PATHS.includes(request.url)) {
      request.auth = {
        client_id: 'anonymous',
        permissions: [],
      };
      return;
    }

    // Skip auth if mode is 'none'
    if (config.mode === 'none') {
      request.auth = {
        client_id: 'anonymous',
        permissions: ['*'], // Allow all when auth is disabled
      };
      return;
    }

    const authHeader = request.headers.authorization;

    // Check for missing Authorization header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const errorResponse: AuthErrorResponse = {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header',
        },
      };
      return reply.code(401).send(errorResponse);
    }

    // Extract token
    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // Validate token
    const tokenConfig = validateToken(token, config);

    if (!tokenConfig) {
      const errorResponse: AuthErrorResponse = {
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid token',
        },
      };
      return reply.code(401).send(errorResponse);
    }

    // Attach auth info to request
    // Note: NEVER log the actual token, only the name
    request.auth = {
      client_id: tokenConfig.name,
      permissions: tokenConfig.permissions,
    };
  };
}
