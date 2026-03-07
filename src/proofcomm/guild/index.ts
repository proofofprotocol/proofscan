/**
 * ProofGuild Module
 * Phase 5: ProofGuild
 *
 * Agent self-registration and Guild membership management.
 */

export {
  type GuildRegisterRequest,
  type GuildRegisterResponse,
  type GuildRegisterResult,
  type RegisterAgentOptions,
  registerGuildAgent,
  validateGuildToken,
  getGuildTokenCount,
  cleanupGuildTokens,
} from './register.js';
