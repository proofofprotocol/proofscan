/**
 * ProofScan Web Monitor - POPL data queries
 */

import { join } from 'path';
import { readdir, readFile, stat } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import type {
  MonitorPoplKpis,
  MonitorPoplEntry,
  MonitorPoplSummary,
} from '../types.js';

/**
 * Get POPL KPIs from .popl directory
 * Note: POPL directory is in CWD (project root), not configDir
 */
export async function getPoplKpis(_configDir: string): Promise<MonitorPoplKpis | null> {
  // POPL is stored in CWD/.popl, not in configDir
  const poplDir = join(process.cwd(), '.popl', 'popl_entries');

  try {
    const entries = await readdir(poplDir);
    // Filter to directories only (ULID-based names, not prefixed with popl_)
    const poplEntries: string[] = [];
    for (const entry of entries) {
      try {
        const entryStat = await stat(join(poplDir, entry));
        if (entryStat.isDirectory()) {
          poplEntries.push(entry);
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    if (poplEntries.length === 0) {
      return {
        entries: 0,
        inscribed: 0,
        ipfs_only: 0,
        failed: 0,
        latest_entry_id: null,
        latest_entries: [],
      };
    }

    let inscribed = 0;
    let ipfs_only = 0;
    let failed = 0;
    let latestEntry: { id: string; created_at: string } | null = null;

    for (const entryDir of poplEntries) {
      const poplYmlPath = join(poplDir, entryDir, 'POPL.yml');
      try {
        const content = await readFile(poplYmlPath, 'utf-8');
        const doc = parseYaml(content);

        // Track latest by created_at
        const createdAt = doc?.entry?.created_at;
        if (createdAt && (!latestEntry || createdAt > latestEntry.created_at)) {
          latestEntry = { id: entryDir, created_at: createdAt };
        }

        // Count by trust level
        const trustLevel = doc?.entry?.trust?.level ?? 0;
        if (trustLevel > 0) {
          inscribed++;
        } else {
          // Check for IPFS artifacts
          const artifacts = doc?.evidence?.artifacts ?? [];
          const hasIpfs = artifacts.some(
            (a: { path?: string }) => a.path?.includes('ipfs')
          );
          if (hasIpfs) {
            ipfs_only++;
          }
        }
      } catch {
        // Failed to read/parse entry
        failed++;
      }
    }

    // Get latest 5 entries for display
    const latestEntries = await getLatestPoplEntries(5);

    return {
      entries: poplEntries.length,
      inscribed,
      ipfs_only,
      failed,
      latest_entry_id: latestEntry?.id ?? null,
      latest_entries: latestEntries,
    };
  } catch {
    // .popl directory doesn't exist
    return null;
  }
}

// =============================================================================
// Phase 10: POPL Entry Detail Queries
// =============================================================================

/**
 * Get POPL entries directory path
 */
function getPoplEntriesDir(): string {
  return join(process.cwd(), '.popl', 'popl_entries');
}

/**
 * Parse a POPL.yml document into MonitorPoplEntry
 */
function parsePoplDocument(
  entryId: string,
  doc: Record<string, unknown>
): MonitorPoplEntry | null {
  try {
    const entry = doc.entry as Record<string, unknown> | undefined;
    const target = doc.target as Record<string, unknown> | undefined;
    const capture = doc.capture as Record<string, unknown> | undefined;
    const evidence = doc.evidence as Record<string, unknown> | undefined;

    if (!entry || !target) return null;

    const trust = entry.trust as Record<string, unknown> | undefined;
    const author = entry.author as Record<string, unknown> | undefined;
    const targetIds = target.ids as Record<string, string> | undefined;
    const window = capture?.window as Record<string, string> | undefined;
    const summary = capture?.summary as Record<string, unknown> | undefined;
    const mcp = capture?.mcp as Record<string, unknown> | undefined;
    const artifacts = evidence?.artifacts as Array<Record<string, string>> | undefined;

    // Extract MCP servers
    const mcpServers: string[] = [];
    const servers = mcp?.servers as Array<Record<string, string>> | undefined;
    if (servers) {
      for (const server of servers) {
        if (server.name) mcpServers.push(server.name);
      }
    }

    return {
      id: entryId,
      created_at: (entry.created_at as string) ?? '',
      title: (entry.title as string) ?? `POPL Entry ${entryId}`,
      author_name: (author?.name as string) ?? 'Unknown',
      trust_level: (trust?.level as number) ?? 0,
      trust_label: (trust?.label as string) ?? 'Recorded',
      target_kind: (target.kind as MonitorPoplEntry['target_kind']) ?? 'session',
      connector_id: targetIds?.connector_id ?? '',
      session_id: targetIds?.session_id ?? null,
      capture: {
        started_at: window?.started_at ?? '',
        ended_at: window?.ended_at ?? '',
        rpc_total: (summary?.rpc_total as number) ?? 0,
        errors: (summary?.errors as number) ?? 0,
        latency_ms_p50: (summary?.latency_ms_p50 as number) ?? null,
        latency_ms_p95: (summary?.latency_ms_p95 as number) ?? null,
        mcp_servers: mcpServers,
      },
      artifacts:
        artifacts?.map((a) => ({
          name: a.name ?? '',
          path: a.path ?? '',
          sha256: a.sha256 ?? '',
        })) ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Convert MonitorPoplEntry to MonitorPoplSummary
 */
function toSummary(entry: MonitorPoplEntry): MonitorPoplSummary {
  return {
    id: entry.id,
    created_at: entry.created_at,
    trust_level: entry.trust_level,
    trust_label: entry.trust_label,
    rpc_total: entry.capture.rpc_total,
    errors: entry.capture.errors,
    session_id: entry.session_id,
  };
}

/**
 * Get single POPL entry by ID
 */
export async function getPoplEntry(
  proofId: string
): Promise<MonitorPoplEntry | null> {
  const poplDir = getPoplEntriesDir();
  const poplYmlPath = join(poplDir, proofId, 'POPL.yml');

  try {
    const content = await readFile(poplYmlPath, 'utf-8');
    const doc = parseYaml(content) as Record<string, unknown>;
    return parsePoplDocument(proofId, doc);
  } catch {
    return null;
  }
}

/**
 * Get all POPL entries for a specific connector
 */
export async function getPoplEntriesByConnector(
  connectorId: string
): Promise<MonitorPoplSummary[]> {
  const poplDir = getPoplEntriesDir();
  const results: MonitorPoplSummary[] = [];

  try {
    const entries = await readdir(poplDir);

    for (const entryDir of entries) {
      try {
        const entryStat = await stat(join(poplDir, entryDir));
        if (!entryStat.isDirectory()) continue;

        const poplYmlPath = join(poplDir, entryDir, 'POPL.yml');
        const content = await readFile(poplYmlPath, 'utf-8');
        const doc = parseYaml(content) as Record<string, unknown>;
        const parsed = parsePoplDocument(entryDir, doc);

        if (parsed && parsed.connector_id === connectorId) {
          results.push(toSummary(parsed));
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Sort by created_at descending (newest first)
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return results;
  } catch {
    return [];
  }
}

/**
 * Get POPL entry by session ID
 */
export async function getPoplEntryBySession(
  sessionId: string
): Promise<MonitorPoplSummary | null> {
  const poplDir = getPoplEntriesDir();

  try {
    const entries = await readdir(poplDir);

    for (const entryDir of entries) {
      try {
        const entryStat = await stat(join(poplDir, entryDir));
        if (!entryStat.isDirectory()) continue;

        const poplYmlPath = join(poplDir, entryDir, 'POPL.yml');
        const content = await readFile(poplYmlPath, 'utf-8');
        const doc = parseYaml(content) as Record<string, unknown>;
        const parsed = parsePoplDocument(entryDir, doc);

        if (parsed && parsed.session_id === sessionId) {
          return toSummary(parsed);
        }
      } catch {
        // Skip invalid entries
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build a lookup map of session_id -> POPL summary for efficient batch lookups
 */
export async function buildSessionPoplMap(): Promise<Map<string, MonitorPoplSummary>> {
  const poplDir = getPoplEntriesDir();
  const map = new Map<string, MonitorPoplSummary>();

  try {
    const entries = await readdir(poplDir);

    for (const entryDir of entries) {
      try {
        const entryStat = await stat(join(poplDir, entryDir));
        if (!entryStat.isDirectory()) continue;

        const poplYmlPath = join(poplDir, entryDir, 'POPL.yml');
        const content = await readFile(poplYmlPath, 'utf-8');
        const doc = parseYaml(content) as Record<string, unknown>;
        const parsed = parsePoplDocument(entryDir, doc);

        if (parsed && parsed.session_id) {
          map.set(parsed.session_id, toSummary(parsed));
        }
      } catch {
        // Skip invalid entries
      }
    }

    return map;
  } catch {
    return map;
  }
}

/**
 * Get latest N POPL entries (sorted by created_at descending)
 */
export async function getLatestPoplEntries(
  limit: number = 5
): Promise<MonitorPoplSummary[]> {
  const poplDir = getPoplEntriesDir();
  const results: MonitorPoplSummary[] = [];

  try {
    const entries = await readdir(poplDir);

    for (const entryDir of entries) {
      try {
        const entryStat = await stat(join(poplDir, entryDir));
        if (!entryStat.isDirectory()) continue;

        const poplYmlPath = join(poplDir, entryDir, 'POPL.yml');
        const content = await readFile(poplYmlPath, 'utf-8');
        const doc = parseYaml(content) as Record<string, unknown>;
        const parsed = parsePoplDocument(entryDir, doc);

        if (parsed) {
          results.push(toSummary(parsed));
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Sort by created_at descending (newest first) and take top N
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return results.slice(0, limit);
  } catch {
    return [];
  }
}
