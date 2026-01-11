/**
 * POPL Service Layer (Phase 6.0)
 *
 * Core service for POPL entry generation.
 * Shared by CLI and shell - neither knows about @references.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, relative, isAbsolute } from 'path';
import { ulid } from 'ulid';
import * as yaml from 'yaml';

import {
  POPL_VERSION,
  TRUST_LABELS,
  type PoplDocument,
  type PoplAuthor,
  type PoplConfig,
  type CreatePoplOptions,
  type CreatePoplResult,
  type TargetKind,
  type TrustLevel,
} from './types.js';
import { generateSessionArtifacts } from './artifacts.js';
import { SANITIZER_RULESET_VERSION } from './sanitizer.js';

/** POPL directory name */
const POPL_DIR = '.popl';

/** POPL entries subdirectory */
const POPL_ENTRIES_DIR = 'popl_entries';

/** POPL config filename */
const POPL_CONFIG_FILE = 'config.json';

/**
 * Check if .popl directory exists
 */
export function hasPoplDir(root: string): boolean {
  return existsSync(join(root, POPL_DIR));
}

/**
 * Get path to .popl directory
 */
export function getPoplDir(root: string): string {
  return join(root, POPL_DIR);
}

/**
 * Get path to popl_entries directory
 */
export function getPoplEntriesDir(root: string): string {
  return join(root, POPL_DIR, POPL_ENTRIES_DIR);
}

/**
 * Initialize .popl directory structure
 */
export async function initPoplDir(root: string): Promise<void> {
  const poplDir = getPoplDir(root);
  const entriesDir = getPoplEntriesDir(root);

  // Create directories
  await mkdir(entriesDir, { recursive: true });

  // Create default config if not exists
  const configPath = join(poplDir, POPL_CONFIG_FILE);
  if (!existsSync(configPath)) {
    const defaultConfig: PoplConfig = {
      author: {
        name: 'Unknown',
      },
      redaction: 'default',
    };
    await writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
  }
}

/**
 * Load POPL config from .popl/config.json
 * Returns empty config with warning on parse error.
 */
export async function loadPoplConfig(root: string): Promise<PoplConfig> {
  const configPath = join(getPoplDir(root), POPL_CONFIG_FILE);

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as PoplConfig;
  } catch (error) {
    // Log warning for invalid config (don't fail silently)
    console.warn(
      `Warning: Failed to parse .popl/config.json: ${error instanceof Error ? error.message : String(error)}`
    );
    return {};
  }
}

/**
 * Convert absolute path to relative path for POPL output
 * Ensures no absolute paths leak into POPL.yml
 */
function toRelativePath(absolutePath: string, baseDir: string): string {
  if (!isAbsolute(absolutePath)) {
    return absolutePath;
  }
  return relative(baseDir, absolutePath);
}

/**
 * Generate default title for a POPL entry
 */
function generateDefaultTitle(
  kind: TargetKind,
  connectorId: string | undefined,
  timestamp: Date
): string {
  const dateStr = timestamp.toISOString().slice(0, 19).replace('T', ' ');
  const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);

  if (connectorId) {
    return `MCP ${kindLabel} POPL Entry ${connectorId} ${dateStr}`;
  }
  return `MCP ${kindLabel} POPL Entry ${dateStr}`;
}

/**
 * Create a POPL entry for a session
 *
 * This is the core service function called by both CLI and shell.
 */
export async function createSessionPoplEntry(
  sessionId: string,
  configDir: string,
  options: Omit<CreatePoplOptions, 'kind' | 'ids'>
): Promise<CreatePoplResult> {
  const { outputRoot, title, author, unsafeIncludeRaw = false } = options;

  // Validate .popl exists
  if (!hasPoplDir(outputRoot)) {
    return {
      success: false,
      error: '.popl directory not found. Run "pfscan popl init" first.',
    };
  }

  try {
    // Generate artifacts and get session info
    const { artifacts, session, summary } = await generateSessionArtifacts(
      sessionId,
      configDir
    );

    // Generate entry ID
    const entryId = ulid();

    // Create entry directory
    const entryPath = join(getPoplEntriesDir(outputRoot), entryId);
    await mkdir(entryPath, { recursive: true });

    // Write artifacts
    const artifactList = [artifacts.status, artifacts.rpc, artifacts.validation];
    if (artifacts.logs) {
      artifactList.push(artifacts.logs);
    }

    for (const artifact of artifactList) {
      const artifactPath = join(entryPath, artifact.artifact.path);
      await writeFile(artifactPath, artifact.content, 'utf-8');
    }

    // Load config for author
    const config = await loadPoplConfig(outputRoot);
    const effectiveAuthor: PoplAuthor = author || config.author || { name: 'Unknown' };

    // Generate title
    const createdAt = new Date();
    const effectiveTitle =
      title || generateDefaultTitle('session', session.connector_id, createdAt);

    // Build POPL document
    const poplDoc: PoplDocument = {
      popl: POPL_VERSION,
      entry: {
        id: entryId,
        created_at: createdAt.toISOString(),
        title: effectiveTitle,
        author: effectiveAuthor,
        trust: {
          level: 0 as TrustLevel,
          label: TRUST_LABELS[0],
        },
      },
      target: {
        kind: 'session',
        name: 'session',
        ids: {
          connector_id: session.connector_id,
          session_id: session.session_id,
        },
      },
      capture: {
        window: {
          started_at: session.started_at,
          ended_at: session.ended_at || createdAt.toISOString(),
        },
        summary,
        mcp: {
          servers: [
            {
              name: session.connector_id,
            },
          ],
        },
      },
      evidence: {
        policy: {
          redaction: unsafeIncludeRaw ? 'none' : 'default',
          ruleset_version: SANITIZER_RULESET_VERSION,
        },
        artifacts: artifactList.map((a) => a.artifact),
      },
    };

    // Write POPL.yml
    const poplYmlPath = join(entryPath, 'POPL.yml');
    const poplYmlContent = yaml.stringify(poplDoc);
    await writeFile(poplYmlPath, poplYmlContent, 'utf-8');

    // Return relative paths for display (avoid leaking absolute paths)
    return {
      success: true,
      entryId,
      entryPath: toRelativePath(entryPath, outputRoot),
      poplYmlPath: toRelativePath(poplYmlPath, outputRoot),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create a POPL entry for a validation plan
 *
 * Plans are static definitions, so POPL entries contain the plan YAML and metadata.
 */
export async function createPlanPoplEntry(
  planName: string,
  planDigest: string,
  planYaml: string,
  planDescription: string | undefined,
  options: Omit<CreatePoplOptions, 'kind' | 'ids'>
): Promise<CreatePoplResult> {
  const { outputRoot, title, author } = options;

  // Validate .popl exists
  if (!hasPoplDir(outputRoot)) {
    return {
      success: false,
      error: '.popl directory not found. Run "pfscan popl init" first.',
    };
  }

  try {
    // Generate entry ID
    const entryId = ulid();

    // Create entry directory
    const entryPath = join(getPoplEntriesDir(outputRoot), entryId);
    await mkdir(entryPath, { recursive: true });

    // Write plan.yaml artifact
    const planArtifactPath = join(entryPath, 'plan.yaml');
    await writeFile(planArtifactPath, planYaml, 'utf-8');

    // Calculate hash
    const crypto = await import('crypto');
    const planHash = crypto.createHash('sha256').update(planYaml).digest('hex');

    // Load config for author
    const config = await loadPoplConfig(outputRoot);
    const effectiveAuthor: PoplAuthor = author || config.author || { name: 'Unknown' };

    // Generate title
    const createdAt = new Date();
    const effectiveTitle = title || `Validation Plan: ${planName}`;

    // Build POPL document
    const poplDoc: PoplDocument = {
      popl: POPL_VERSION,
      entry: {
        id: entryId,
        created_at: createdAt.toISOString(),
        title: effectiveTitle,
        author: effectiveAuthor,
        trust: {
          level: 0 as TrustLevel,
          label: TRUST_LABELS[0],
        },
      },
      target: {
        kind: 'plan',
        name: planName,
        ids: {
          plan_name: planName,
        },
      },
      capture: {
        window: {
          started_at: createdAt.toISOString(),
          ended_at: createdAt.toISOString(),
        },
        summary: {
          rpc_total: 0,
          errors: 0,
        },
      },
      evidence: {
        policy: {
          redaction: 'none',
          ruleset_version: SANITIZER_RULESET_VERSION,
        },
        artifacts: [
          {
            name: 'Plan Definition',
            path: 'plan.yaml',
            sha256: planHash,
          },
        ],
      },
    };

    // Write POPL.yml
    const poplYmlPath = join(entryPath, 'POPL.yml');
    const poplYmlContent = yaml.stringify(poplDoc);
    await writeFile(poplYmlPath, poplYmlContent, 'utf-8');

    return {
      success: true,
      entryId,
      entryPath: toRelativePath(entryPath, outputRoot),
      poplYmlPath: toRelativePath(poplYmlPath, outputRoot),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create a POPL entry for a plan run
 *
 * Run entries contain the execution results, inventory, and plan used.
 */
export async function createRunPoplEntry(
  runId: string,
  planName: string | null,
  planDigest: string,
  connectorId: string,
  status: string,
  resultsJson: string,
  inventoryJson: string,
  planYaml: string,
  startedAt: string,
  endedAt: string,
  options: Omit<CreatePoplOptions, 'kind' | 'ids'>
): Promise<CreatePoplResult> {
  const { outputRoot, title, author } = options;

  // Validate .popl exists
  if (!hasPoplDir(outputRoot)) {
    return {
      success: false,
      error: '.popl directory not found. Run "pfscan popl init" first.',
    };
  }

  try {
    // Generate entry ID
    const entryId = ulid();

    // Create entry directory
    const entryPath = join(getPoplEntriesDir(outputRoot), entryId);
    await mkdir(entryPath, { recursive: true });

    // Write artifacts
    const artifacts = [
      { name: 'results.json', content: resultsJson },
      { name: 'inventory.json', content: inventoryJson },
      { name: 'plan.yaml', content: planYaml },
    ];

    const crypto = await import('crypto');
    const artifactList: { name: string; path: string; sha256: string }[] = [];

    for (const artifact of artifacts) {
      const artifactPath = join(entryPath, artifact.name);
      await writeFile(artifactPath, artifact.content, 'utf-8');
      const hash = crypto.createHash('sha256').update(artifact.content).digest('hex');
      artifactList.push({
        name: artifact.name,
        path: artifact.name,
        sha256: hash,
      });
    }

    // Calculate stats from results
    let rpcTotal = 0;
    let errors = 0;
    try {
      const results = JSON.parse(resultsJson);
      if (Array.isArray(results)) {
        rpcTotal = results.filter((r: { skipped?: boolean }) => !r.skipped).length;
        errors = results.filter((r: { response?: { error?: unknown } }) => r.response?.error).length;
      }
    } catch {
      // Ignore parse errors
    }

    // Load config for author
    const config = await loadPoplConfig(outputRoot);
    const effectiveAuthor: PoplAuthor = author || config.author || { name: 'Unknown' };

    // Generate title
    const createdAt = new Date();
    const planLabel = planName || `digest:${planDigest.slice(0, 8)}`;
    const effectiveTitle = title || `Plan Run: ${planLabel} on ${connectorId}`;

    // Build POPL document
    const poplDoc: PoplDocument = {
      popl: POPL_VERSION,
      entry: {
        id: entryId,
        created_at: createdAt.toISOString(),
        title: effectiveTitle,
        author: effectiveAuthor,
        trust: {
          level: 0 as TrustLevel,
          label: TRUST_LABELS[0],
        },
      },
      target: {
        kind: 'run',
        name: `run:${runId.slice(0, 8)}`,
        ids: {
          run_id: runId,
          connector_id: connectorId,
          ...(planName && { plan_name: planName }),
        },
      },
      capture: {
        window: {
          started_at: startedAt,
          ended_at: endedAt,
        },
        summary: {
          rpc_total: rpcTotal,
          errors,
        },
        mcp: {
          servers: [{ name: connectorId }],
        },
      },
      evidence: {
        policy: {
          redaction: 'default',
          ruleset_version: SANITIZER_RULESET_VERSION,
        },
        artifacts: artifactList,
      },
    };

    // Write POPL.yml
    const poplYmlPath = join(entryPath, 'POPL.yml');
    const poplYmlContent = yaml.stringify(poplDoc);
    await writeFile(poplYmlPath, poplYmlContent, 'utf-8');

    return {
      success: true,
      entryId,
      entryPath: toRelativePath(entryPath, outputRoot),
      poplYmlPath: toRelativePath(poplYmlPath, outputRoot),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List existing POPL entries
 */
export async function listPoplEntries(
  root: string
): Promise<{ id: string; path: string }[]> {
  const entriesDir = getPoplEntriesDir(root);

  if (!existsSync(entriesDir)) {
    return [];
  }

  const { readdir } = await import('fs/promises');
  const entries = await readdir(entriesDir, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      id: e.name,
      path: join(entriesDir, e.name),
    }));
}

/**
 * Read a POPL entry document
 */
export async function readPoplEntry(entryPath: string): Promise<PoplDocument | null> {
  const poplYmlPath = join(entryPath, 'POPL.yml');

  if (!existsSync(poplYmlPath)) {
    return null;
  }

  try {
    const content = await readFile(poplYmlPath, 'utf-8');
    return yaml.parse(content) as PoplDocument;
  } catch {
    return null;
  }
}
