/**
 * Tests for trust policy
 */

import { describe, it, expect } from 'vitest';
import type { ServerInfo } from './client.js';
import {
  determineTrust,
  shouldAllowInstall,
  getInstallWarning,
  formatTrustBadge,
  formatTrustBadgeColor,
  DEFAULT_TRUSTED_NPM_SCOPES,
  type CatalogSecurityConfig,
} from './trust.js';

describe('determineTrust', () => {
  describe('github source', () => {
    it('should return trusted with github-reference root', () => {
      const server: ServerInfo = { name: '@modelcontextprotocol/server-fetch' };
      const trust = determineTrust(server, 'github');

      expect(trust.level).toBe('trusted');
      expect(trust.root).toBe('github-reference');
      expect(trust.reason).toContain('reference server');
    });

    it('should be trusted regardless of package info', () => {
      const server: ServerInfo = {
        name: 'some-server',
        packages: [{ registryType: 'pypi', identifier: 'random-package' }],
      };
      const trust = determineTrust(server, 'github');

      expect(trust.level).toBe('trusted');
      expect(trust.root).toBe('github-reference');
    });
  });

  describe('npm package scope', () => {
    it('should return trusted for @modelcontextprotocol scope', () => {
      const server: ServerInfo = {
        name: 'server-time',
        packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server-time' }],
      };
      const trust = determineTrust(server, 'npm');

      expect(trust.level).toBe('trusted');
      expect(trust.root).toBe('npm-scope');
      expect(trust.reason).toContain('@modelcontextprotocol');
    });

    it('should return trusted for @anthropic scope', () => {
      const server: ServerInfo = {
        name: 'claude-mcp',
        packages: [{ registryType: 'npm', identifier: '@anthropic/claude-mcp' }],
      };
      const trust = determineTrust(server, 'npm');

      expect(trust.level).toBe('trusted');
      expect(trust.root).toBe('npm-scope');
      expect(trust.reason).toContain('@anthropic');
    });

    it('should return unknown for npm package outside trusted scopes', () => {
      const server: ServerInfo = {
        name: 'random-mcp',
        packages: [{ registryType: 'npm', identifier: '@random/mcp-server' }],
      };
      const trust = determineTrust(server, 'npm');

      expect(trust.level).toBe('unknown');
      expect(trust.root).toBe('unknown');
      expect(trust.reason).toContain('not in trusted list');
    });

    it('should return unknown for unscoped npm package', () => {
      const server: ServerInfo = {
        name: 'unscoped-mcp',
        packages: [{ registryType: 'npm', identifier: 'unscoped-mcp-server' }],
      };
      const trust = determineTrust(server, 'npm');

      expect(trust.level).toBe('unknown');
      expect(trust.root).toBe('unknown');
      expect(trust.reason).toContain('without scope');
    });

    it('should respect custom trustedNpmScopes', () => {
      const server: ServerInfo = {
        name: 'company-mcp',
        packages: [{ registryType: 'npm', identifier: '@mycompany/mcp-server' }],
      };
      const config: CatalogSecurityConfig = {
        trustedNpmScopes: ['@mycompany'],
      };
      const trust = determineTrust(server, 'npm', config);

      expect(trust.level).toBe('trusted');
      expect(trust.root).toBe('npm-scope');
      expect(trust.reason).toContain('@mycompany');
    });

    it('should use default scopes when trustedNpmScopes not set', () => {
      const server: ServerInfo = {
        name: 'server',
        packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server' }],
      };
      const trust = determineTrust(server, 'npm', undefined);

      expect(trust.level).toBe('trusted');
      expect(DEFAULT_TRUSTED_NPM_SCOPES).toContain('@modelcontextprotocol');
    });
  });

  describe('smithery source', () => {
    it('should return untrusted with smithery root', () => {
      const server: ServerInfo = { name: 'community/server' };
      const trust = determineTrust(server, 'smithery');

      expect(trust.level).toBe('untrusted');
      expect(trust.root).toBe('smithery');
      expect(trust.reason).toContain('Community');
    });
  });

  describe('official source', () => {
    it('should return unknown with official-registry root', () => {
      const server: ServerInfo = { name: 'some-server' };
      const trust = determineTrust(server, 'official');

      expect(trust.level).toBe('unknown');
      expect(trust.root).toBe('official-registry');
      expect(trust.reason).toContain('unknown provenance');
    });

    it('should check npm scope even for official source', () => {
      const server: ServerInfo = {
        name: 'server',
        packages: [{ registryType: 'npm', identifier: '@modelcontextprotocol/server' }],
      };
      const trust = determineTrust(server, 'official');

      expect(trust.level).toBe('trusted');
      expect(trust.root).toBe('npm-scope');
    });
  });

  describe('unknown source', () => {
    it('should return unknown for unrecognized source', () => {
      const server: ServerInfo = { name: 'server' };
      const trust = determineTrust(server, 'other');

      expect(trust.level).toBe('unknown');
      expect(trust.root).toBe('unknown');
    });
  });
});

describe('shouldAllowInstall', () => {
  const trustedInfo = { level: 'trusted' as const, reason: 'test', root: 'npm-scope' as const };
  const untrustedInfo = { level: 'untrusted' as const, reason: 'test', root: 'smithery' as const };
  const unknownInfo = { level: 'unknown' as const, reason: 'test', root: 'unknown' as const };

  describe('without trustedOnly', () => {
    it('should allow trusted servers', () => {
      const result = shouldAllowInstall(trustedInfo, 'npm');
      expect(result.allowed).toBe(true);
    });

    it('should allow untrusted servers (default behavior)', () => {
      const result = shouldAllowInstall(untrustedInfo, 'smithery');
      expect(result.allowed).toBe(true);
    });

    it('should allow unknown servers (default behavior)', () => {
      const result = shouldAllowInstall(unknownInfo, 'official');
      expect(result.allowed).toBe(true);
    });
  });

  describe('with trustedOnly: true', () => {
    const config: CatalogSecurityConfig = { trustedOnly: true };

    it('should allow trusted servers', () => {
      const result = shouldAllowInstall(trustedInfo, 'npm', config);
      expect(result.allowed).toBe(true);
    });

    it('should block untrusted servers', () => {
      const result = shouldAllowInstall(untrustedInfo, 'smithery', config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('trusted servers only');
    });

    it('should block unknown servers', () => {
      const result = shouldAllowInstall(unknownInfo, 'official', config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('trusted servers only');
    });

    it('should allow untrusted with --allow-untrusted flag', () => {
      const result = shouldAllowInstall(untrustedInfo, 'smithery', config, true);
      expect(result.allowed).toBe(true);
    });
  });

  describe('with allowSources', () => {
    it('should block source when allowSources[source] is false', () => {
      const config: CatalogSecurityConfig = {
        allowSources: { smithery: false },
      };
      const result = shouldAllowInstall(trustedInfo, 'smithery', config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled for installation');
    });

    it('should allow source when allowSources[source] is true', () => {
      const config: CatalogSecurityConfig = {
        allowSources: { smithery: true },
      };
      const result = shouldAllowInstall(untrustedInfo, 'smithery', config);
      expect(result.allowed).toBe(true);
    });

    it('should allow source when not mentioned in allowSources', () => {
      const config: CatalogSecurityConfig = {
        allowSources: { npm: false },
      };
      const result = shouldAllowInstall(untrustedInfo, 'smithery', config);
      expect(result.allowed).toBe(true);
    });

    it('should check allowSources before trust level', () => {
      // Even trusted server should be blocked if source is disabled
      const config: CatalogSecurityConfig = {
        allowSources: { npm: false },
      };
      const result = shouldAllowInstall(trustedInfo, 'npm', config);
      expect(result.allowed).toBe(false);
    });
  });
});

describe('getInstallWarning', () => {
  it('should return null for trusted servers', () => {
    const trust = { level: 'trusted' as const, reason: 'test', root: 'npm-scope' as const };
    expect(getInstallWarning(trust)).toBeNull();
  });

  it('should return warning for untrusted servers', () => {
    const trust = { level: 'untrusted' as const, reason: 'Community', root: 'smithery' as const };
    const warning = getInstallWarning(trust);
    expect(warning).toContain('untrusted');
    expect(warning).toContain('Community');
  });

  it('should return warning for unknown servers', () => {
    const trust = { level: 'unknown' as const, reason: 'test', root: 'unknown' as const };
    const warning = getInstallWarning(trust);
    expect(warning).toContain('unknown');
  });
});

describe('formatTrustBadge', () => {
  it('should format trusted badge', () => {
    const trust = { level: 'trusted' as const, reason: 'test', root: 'npm-scope' as const };
    expect(formatTrustBadge(trust)).toBe('[trusted:npm-scope]');
  });

  it('should format untrusted badge', () => {
    const trust = { level: 'untrusted' as const, reason: 'test', root: 'smithery' as const };
    expect(formatTrustBadge(trust)).toBe('[untrusted:smithery]');
  });

  it('should format unknown badge', () => {
    const trust = { level: 'unknown' as const, reason: 'test', root: 'official-registry' as const };
    expect(formatTrustBadge(trust)).toBe('[unknown:official-registry]');
  });
});

describe('formatTrustBadgeColor', () => {
  it('should include ANSI green for trusted', () => {
    const trust = { level: 'trusted' as const, reason: 'test', root: 'npm-scope' as const };
    const badge = formatTrustBadgeColor(trust);
    expect(badge).toContain('\x1b[32m'); // green
    expect(badge).toContain('[trusted:npm-scope]');
    expect(badge).toContain('\x1b[0m'); // reset
  });

  it('should include ANSI yellow for untrusted', () => {
    const trust = { level: 'untrusted' as const, reason: 'test', root: 'smithery' as const };
    const badge = formatTrustBadgeColor(trust);
    expect(badge).toContain('\x1b[33m'); // yellow
    expect(badge).toContain('[untrusted:smithery]');
  });

  it('should include ANSI gray for unknown', () => {
    const trust = { level: 'unknown' as const, reason: 'test', root: 'unknown' as const };
    const badge = formatTrustBadgeColor(trust);
    expect(badge).toContain('\x1b[90m'); // gray
    expect(badge).toContain('[unknown:unknown]');
  });
});
