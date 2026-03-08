/**
 * ProofGuild Module
 * Phase 5: ProofGuild
 *
 * Agent registration with API key authentication.
 */

export {
  type GuildRegisterRequest,
  type GuildRegisterResponse,
  type GuildRegisterResult,
  type RegisterAgentOptions,
  registerGuildAgent,
  validateApiKey,
  isApiKeyConfigured,
  validateGuildToken,
  getGuildTokenCount,
  cleanupGuildTokens,
  isExternalUrl,
  resetCachedTokenSecret,
} from './register.js';
