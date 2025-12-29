/**
 * Config snapshot management
 *
 * Stores snapshots of config in state/config-snapshots/
 * Maintains an index file with metadata for each snapshot.
 */

import { createHash } from 'crypto';
import { join } from 'path';
import { mkdir, unlink } from 'fs/promises';
import type { Config } from '../types/index.js';
import { atomicWriteFile, readFileSafe, fileExists } from '../utils/fs.js';

// ============================================================
// Types
// ============================================================

/** Snapshot metadata */
export interface SnapshotMeta {
  id: string;
  created_at: string;
  note: string | null;
  file_name: string;
  connector_count: number;
  hash: string;
}

/** Snapshot index */
export interface SnapshotIndex {
  version: 1;
  snapshots: SnapshotMeta[];
}

/** Snapshot with full config */
export interface Snapshot {
  meta: SnapshotMeta;
  config: Config;
}

/** Diff between two configs */
export interface ConfigDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

// ============================================================
// Snapshot Manager
// ============================================================

export class SnapshotManager {
  private snapshotDir: string;
  private indexPath: string;

  constructor(configDir: string) {
    this.snapshotDir = join(configDir, 'config-snapshots');
    this.indexPath = join(this.snapshotDir, 'index.json');
  }

  /**
   * Ensure snapshot directory exists
   */
  private async ensureDir(): Promise<void> {
    await mkdir(this.snapshotDir, { recursive: true });
  }

  /**
   * Load snapshot index
   */
  async loadIndex(): Promise<SnapshotIndex> {
    const content = await readFileSafe(this.indexPath);
    if (!content) {
      return { version: 1, snapshots: [] };
    }

    try {
      return JSON.parse(content) as SnapshotIndex;
    } catch {
      return { version: 1, snapshots: [] };
    }
  }

  /**
   * Save snapshot index
   */
  private async saveIndex(index: SnapshotIndex): Promise<void> {
    await this.ensureDir();
    await atomicWriteFile(this.indexPath, JSON.stringify(index, null, 2) + '\n');
  }

  /**
   * Compute hash of config for comparison
   */
  computeHash(config: Config): string {
    const canonical = JSON.stringify(config);
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  }

  /**
   * Generate snapshot ID from timestamp
   */
  private generateId(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  /**
   * Save a snapshot of current config
   */
  async save(config: Config, note?: string): Promise<SnapshotMeta> {
    await this.ensureDir();

    const id = this.generateId();
    const hash = this.computeHash(config);
    const noteSuffix = note ? `_${note.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30)}` : '';
    const fileName = `${id}${noteSuffix}.json`;
    const filePath = join(this.snapshotDir, fileName);

    // Save snapshot file
    await atomicWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');

    // Update index
    const index = await this.loadIndex();
    const meta: SnapshotMeta = {
      id,
      created_at: new Date().toISOString(),
      note: note || null,
      file_name: fileName,
      connector_count: config.connectors.length,
      hash,
    };

    index.snapshots.unshift(meta); // newest first
    await this.saveIndex(index);

    return meta;
  }

  /**
   * List all snapshots (newest first)
   */
  async list(): Promise<SnapshotMeta[]> {
    const index = await this.loadIndex();
    return index.snapshots;
  }

  /**
   * Get snapshot by display number (1-indexed, newest first)
   */
  async getByNumber(num: number): Promise<Snapshot | null> {
    const index = await this.loadIndex();
    if (num < 1 || num > index.snapshots.length) {
      return null;
    }

    const meta = index.snapshots[num - 1];
    const filePath = join(this.snapshotDir, meta.file_name);
    const content = await readFileSafe(filePath);

    if (!content) {
      return null;
    }

    try {
      const config = JSON.parse(content) as Config;
      return { meta, config };
    } catch {
      return null;
    }
  }

  /**
   * Delete snapshot by display number
   */
  async delete(num: number): Promise<SnapshotMeta | null> {
    const index = await this.loadIndex();
    if (num < 1 || num > index.snapshots.length) {
      return null;
    }

    const meta = index.snapshots[num - 1];
    const filePath = join(this.snapshotDir, meta.file_name);

    // Remove file if exists
    if (await fileExists(filePath)) {
      await unlink(filePath);
    }

    // Remove from index
    index.snapshots.splice(num - 1, 1);
    await this.saveIndex(index);

    return meta;
  }

  /**
   * Find snapshot matching current config by hash
   */
  async findMatchingSnapshot(config: Config): Promise<number | null> {
    const hash = this.computeHash(config);
    const index = await this.loadIndex();

    for (let i = 0; i < index.snapshots.length; i++) {
      if (index.snapshots[i].hash === hash) {
        return i + 1; // 1-indexed
      }
    }

    return null;
  }

  /**
   * Compare two configs and return diff
   */
  diffConfigs(current: Config, target: Config): ConfigDiff {
    const currentIds = new Set(current.connectors.map(c => c.id));
    const targetIds = new Set(target.connectors.map(c => c.id));

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    const unchanged: string[] = [];

    // Find removed (in current but not in target)
    for (const id of currentIds) {
      if (!targetIds.has(id)) {
        removed.push(id);
      }
    }

    // Find added and changed
    for (const targetConn of target.connectors) {
      if (!currentIds.has(targetConn.id)) {
        added.push(targetConn.id);
      } else {
        // Check if changed
        const currentConn = current.connectors.find(c => c.id === targetConn.id)!;
        if (JSON.stringify(currentConn) !== JSON.stringify(targetConn)) {
          changed.push(targetConn.id);
        } else {
          unchanged.push(targetConn.id);
        }
      }
    }

    return { added, removed, changed, unchanged };
  }
}

// ============================================================
// Formatting helpers
// ============================================================

/**
 * Format snapshot for display
 */
export function formatSnapshotLine(
  num: number,
  meta: SnapshotMeta,
  isCurrent: boolean = false
): string {
  const date = new Date(meta.created_at);
  const dateStr = date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const note = meta.note ? ` "${meta.note}"` : '';
  const current = isCurrent ? ' [current]' : '';
  const connectors = `${meta.connector_count} connectors`;

  return `  ${num}. ${dateStr} - ${connectors}${note}${current}`;
}

/**
 * Format config diff for display
 */
export function formatConfigDiff(diff: ConfigDiff): string {
  const lines: string[] = [];

  if (diff.added.length > 0) {
    lines.push(`  + Added: ${diff.added.join(', ')}`);
  }
  if (diff.removed.length > 0) {
    lines.push(`  - Removed: ${diff.removed.join(', ')}`);
  }
  if (diff.changed.length > 0) {
    lines.push(`  ~ Changed: ${diff.changed.join(', ')}`);
  }
  if (diff.unchanged.length > 0) {
    lines.push(`  = Unchanged: ${diff.unchanged.join(', ')}`);
  }

  if (lines.length === 0) {
    lines.push('  No changes');
  }

  return lines.join('\n');
}
