/**
 * Config manager - handles reading, writing, and modifying config
 */

import { Config, Connector, DEFAULT_CONFIG } from '../types/index.js';
import { resolveConfigPath } from '../utils/config-path.js';
import { atomicWriteFile, readFileSafe, fileExists } from '../utils/fs.js';
import { parseConfig, validateConfig, ValidationResult } from './schema.js';
import { dirname } from 'path';

export class ConfigManager {
  private configPath: string;
  private config: Config | null = null;
  /** Cache TTL in milliseconds (default: 5 seconds) */
  private cacheTtlMs: number;
  /** Timestamp when cache was last updated */
  private cacheUpdatedAt: number = 0;

  constructor(configPath?: string, options?: { cacheTtlMs?: number }) {
    this.configPath = resolveConfigPath({ configPath });
    this.cacheTtlMs = options?.cacheTtlMs ?? 5000;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getConfigDir(): string {
    return dirname(this.configPath);
  }

  async exists(): Promise<boolean> {
    return fileExists(this.configPath);
  }

  async load(): Promise<Config> {
    // Return cached config if still valid
    const now = Date.now();
    if (this.config && (now - this.cacheUpdatedAt) < this.cacheTtlMs) {
      return this.config;
    }

    const content = await readFileSafe(this.configPath);
    if (content === null) {
      throw new Error(`Config file not found: ${this.configPath}`);
    }

    const { config, errors } = parseConfig(content);
    if (!config) {
      throw new Error(`Invalid config: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
    }

    this.config = config;
    this.cacheUpdatedAt = now;
    return config;
  }

  /**
   * Invalidate the config cache (force reload on next access)
   */
  invalidateCache(): void {
    this.cacheUpdatedAt = 0;
  }

  async loadOrDefault(): Promise<Config> {
    try {
      return await this.load();
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async save(config: Config): Promise<void> {
    const result = validateConfig(config);
    if (!result.valid) {
      throw new Error(`Invalid config: ${result.errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
    }

    await atomicWriteFile(this.configPath, JSON.stringify(config, null, 2) + '\n');
    this.config = config;
  }

  async init(force: boolean = false): Promise<{ created: boolean; path: string }> {
    const exists = await this.exists();
    if (exists && !force) {
      return { created: false, path: this.configPath };
    }

    await this.save({ ...DEFAULT_CONFIG });
    return { created: true, path: this.configPath };
  }

  async validate(): Promise<ValidationResult> {
    const content = await readFileSafe(this.configPath);
    if (content === null) {
      return { valid: false, errors: [{ path: '', message: 'Config file not found' }] };
    }

    const { errors } = parseConfig(content);
    return { valid: errors.length === 0, errors };
  }

  // Connector operations
  async getConnectors(): Promise<Connector[]> {
    const config = await this.load();
    return config.connectors;
  }

  async getConnector(id: string): Promise<Connector | null> {
    const config = await this.load();
    return config.connectors.find(c => c.id === id) || null;
  }

  async addConnector(connector: Connector): Promise<void> {
    const config = await this.load();

    if (config.connectors.some(c => c.id === connector.id)) {
      throw new Error(`Connector with id '${connector.id}' already exists`);
    }

    config.connectors.push(connector);
    await this.save(config);
  }

  async updateConnector(id: string, updates: Partial<Connector>): Promise<void> {
    const config = await this.load();
    const index = config.connectors.findIndex(c => c.id === id);

    if (index === -1) {
      throw new Error(`Connector not found: ${id}`);
    }

    // Don't allow changing ID through update (destructure to remove from updates)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...safeUpdates } = updates;
    config.connectors[index] = { ...config.connectors[index], ...safeUpdates };
    await this.save(config);
  }

  async removeConnector(id: string): Promise<void> {
    const config = await this.load();
    const index = config.connectors.findIndex(c => c.id === id);

    if (index === -1) {
      throw new Error(`Connector not found: ${id}`);
    }

    config.connectors.splice(index, 1);
    await this.save(config);
  }

  async enableConnector(id: string): Promise<void> {
    await this.updateConnector(id, { enabled: true });
  }

  async disableConnector(id: string): Promise<void> {
    await this.updateConnector(id, { enabled: false });
  }
}
