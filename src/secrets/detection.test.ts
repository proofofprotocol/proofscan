/**
 * Tests for secret detection utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isSecretKey,
  isPlaceholder,
  looksLikeRealSecret,
  detectSecret,
  scanEnvForSecrets,
  countSecrets,
} from './detection.js';

describe('isSecretKey', () => {
  it('should detect API key patterns', () => {
    expect(isSecretKey('OPENAI_API_KEY')).toBe(true);
    expect(isSecretKey('api_key')).toBe(true);
    expect(isSecretKey('apiKey')).toBe(true);
    expect(isSecretKey('API-KEY')).toBe(true);
    expect(isSecretKey('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('should detect token patterns', () => {
    expect(isSecretKey('ACCESS_TOKEN')).toBe(true);
    expect(isSecretKey('access-token')).toBe(true);
    expect(isSecretKey('auth_token')).toBe(true);
    expect(isSecretKey('BEARER_TOKEN')).toBe(true);
  });

  it('should detect secret patterns', () => {
    expect(isSecretKey('SECRET')).toBe(true);
    expect(isSecretKey('secret_key')).toBe(true);
    expect(isSecretKey('CLIENT_SECRET')).toBe(true);
  });

  it('should detect password patterns', () => {
    expect(isSecretKey('PASSWORD')).toBe(true);
    expect(isSecretKey('password')).toBe(true);
    expect(isSecretKey('PASSWD')).toBe(true);
    expect(isSecretKey('DB_PASSWORD')).toBe(true);
  });

  it('should detect credential patterns', () => {
    expect(isSecretKey('CREDENTIALS')).toBe(true);
    expect(isSecretKey('credentials')).toBe(true);
    expect(isSecretKey('AWS_CREDENTIALS')).toBe(true);
  });

  it('should detect authorization patterns', () => {
    expect(isSecretKey('AUTHORIZATION')).toBe(true);
    expect(isSecretKey('authorization')).toBe(true);
    expect(isSecretKey('bearer')).toBe(true);
  });

  it('should NOT detect non-secret keys', () => {
    expect(isSecretKey('PATH')).toBe(false);
    expect(isSecretKey('HOME')).toBe(false);
    expect(isSecretKey('DEBUG')).toBe(false);
    expect(isSecretKey('LOG_LEVEL')).toBe(false);
    expect(isSecretKey('NODE_ENV')).toBe(false);
    expect(isSecretKey('PORT')).toBe(false);
  });
});

describe('isPlaceholder', () => {
  it('should detect YOUR_* patterns', () => {
    expect(isPlaceholder('YOUR_API_KEY')).toBe(true);
    expect(isPlaceholder('your api key')).toBe(true);
    expect(isPlaceholder('YOUR-TOKEN')).toBe(true);
    expect(isPlaceholder('your_secret')).toBe(true);
    expect(isPlaceholder('your-password')).toBe(true);
  });

  it('should detect *_HERE patterns', () => {
    expect(isPlaceholder('YOUR_KEY_HERE')).toBe(true);
    expect(isPlaceholder('insert here')).toBe(true);
  });

  it('should detect bracket patterns', () => {
    expect(isPlaceholder('<YOUR_API_KEY>')).toBe(true);
    expect(isPlaceholder('[YOUR_TOKEN]')).toBe(true);
    expect(isPlaceholder('{API_KEY}')).toBe(true);
  });

  it('should detect CHANGEME patterns', () => {
    expect(isPlaceholder('CHANGEME')).toBe(true);
    expect(isPlaceholder('changeme')).toBe(true);
    expect(isPlaceholder('change-me')).toBe(true);
    expect(isPlaceholder('change_me')).toBe(true);
  });

  it('should detect XXX patterns', () => {
    expect(isPlaceholder('xxx')).toBe(true);
    expect(isPlaceholder('XXXX')).toBe(true);
    expect(isPlaceholder('xxxxxxxx')).toBe(true);
  });

  it('should detect sk-xxx patterns (placeholder format)', () => {
    expect(isPlaceholder('sk-xxx')).toBe(true);
    expect(isPlaceholder('sk-xxxx')).toBe(true);
    expect(isPlaceholder('pk-xxx')).toBe(true);
  });

  it('should detect other placeholder keywords', () => {
    expect(isPlaceholder('placeholder')).toBe(true);
    expect(isPlaceholder('PLACEHOLDER')).toBe(true);
    expect(isPlaceholder('TODO')).toBe(true);
    expect(isPlaceholder('FIXME')).toBe(true);
    expect(isPlaceholder('replace-me')).toBe(true);
  });

  it('should NOT detect real values', () => {
    expect(isPlaceholder('sk-1234567890abcdefghij')).toBe(false);
    expect(isPlaceholder('ghp_abcdefghijklmnopqrstuvwxyz123456')).toBe(false);
    expect(isPlaceholder('some-actual-value-here')).toBe(false);
    expect(isPlaceholder('/usr/local/bin')).toBe(false);
  });

  it('should NOT detect empty or short strings', () => {
    expect(isPlaceholder('')).toBe(false);
    expect(isPlaceholder('ab')).toBe(false);
  });
});

describe('looksLikeRealSecret', () => {
  it('should detect OpenAI-style keys', () => {
    expect(looksLikeRealSecret('sk-1234567890abcdefghijklmnop')).toBe(true);
  });

  it('should detect GitHub tokens', () => {
    expect(looksLikeRealSecret('ghp_abcdefghijklmnopqrstuvwxyz1234567890')).toBe(true);
    expect(looksLikeRealSecret('gho_abcdefghijklmnopqrstuvwxyz1234567890')).toBe(true);
    expect(looksLikeRealSecret('github_pat_abcdefghijklmnopqrstuvwx')).toBe(true);
  });

  it('should detect long alphanumeric tokens', () => {
    expect(looksLikeRealSecret('abcdefghijklmnopqrstuvwxyz1234567890')).toBe(true);
    expect(looksLikeRealSecret('AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe(true);
  });

  it('should NOT detect short values', () => {
    expect(looksLikeRealSecret('short')).toBe(false);
    expect(looksLikeRealSecret('abc123')).toBe(false);
  });

  it('should NOT detect placeholders', () => {
    expect(looksLikeRealSecret('YOUR_API_KEY')).toBe(false);
    expect(looksLikeRealSecret('CHANGEME')).toBe(false);
  });
});

describe('detectSecret', () => {
  it('should recommend store for real secrets', () => {
    const result = detectSecret('OPENAI_API_KEY', 'sk-1234567890abcdefghijklmnop');
    expect(result.isSecretKey).toBe(true);
    expect(result.isPlaceholder).toBe(false);
    expect(result.looksLikeSecret).toBe(true);
    expect(result.action).toBe('store');
  });

  it('should recommend warn for placeholders', () => {
    const result = detectSecret('API_KEY', 'YOUR_API_KEY');
    expect(result.isSecretKey).toBe(true);
    expect(result.isPlaceholder).toBe(true);
    expect(result.action).toBe('warn');
  });

  it('should recommend skip for non-secret keys', () => {
    const result = detectSecret('PATH', '/usr/bin');
    expect(result.isSecretKey).toBe(false);
    expect(result.action).toBe('skip');
  });

  it('should recommend store for unknown value formats on secret keys', () => {
    const result = detectSecret('PASSWORD', 'some-value');
    expect(result.isSecretKey).toBe(true);
    expect(result.isPlaceholder).toBe(false);
    expect(result.looksLikeSecret).toBe(false);
    expect(result.action).toBe('store');
  });
});

describe('scanEnvForSecrets', () => {
  it('should find all secret keys in env', () => {
    const env = {
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'sk-test123456789012345678901234',
      DEBUG: 'true',
      PASSWORD: 'secret123',
    };

    const results = scanEnvForSecrets(env);

    expect(results).toHaveLength(2);
    expect(results.map(r => r.key)).toContain('OPENAI_API_KEY');
    expect(results.map(r => r.key)).toContain('PASSWORD');
    expect(results.map(r => r.key)).not.toContain('PATH');
    expect(results.map(r => r.key)).not.toContain('DEBUG');
  });

  it('should return empty array for env with no secrets', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      NODE_ENV: 'production',
    };

    const results = scanEnvForSecrets(env);
    expect(results).toHaveLength(0);
  });
});

describe('countSecrets', () => {
  it('should count secrets by action type', () => {
    const env = {
      OPENAI_API_KEY: 'sk-real1234567890123456789012',
      ANTHROPIC_API_KEY: 'YOUR_API_KEY',
      DEBUG: 'true',
    };

    const counts = countSecrets(env);

    expect(counts.total).toBe(2);
    expect(counts.toStore).toBe(1);
    expect(counts.warnings).toBe(1);
  });

  it('should return zeros for empty env', () => {
    const counts = countSecrets({});
    expect(counts.total).toBe(0);
    expect(counts.toStore).toBe(0);
    expect(counts.warnings).toBe(0);
  });
});
