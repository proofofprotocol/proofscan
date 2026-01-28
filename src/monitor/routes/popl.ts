/**
 * ProofScan Web Monitor - POPL entry routes
 */

import { Hono } from 'hono';
import { join, resolve, relative } from 'path';
import { readFile, stat } from 'fs/promises';
import type { MonitorEnv } from '../server.js';
import { renderPoplDetailPage, renderPopl404Page, renderArtifactPage } from '../templates/popl.js';
import { getPoplEntry } from '../data/popl.js';

export const poplRoutes = new Hono<MonitorEnv>();

// GET /:proof_id - POPL entry detail page
poplRoutes.get('/:proof_id', async (c) => {
  const proofId = c.req.param('proof_id');

  const entry = await getPoplEntry(proofId);

  if (!entry) {
    return c.html(renderPopl404Page(proofId), 404);
  }

  const html = renderPoplDetailPage(entry);
  return c.html(html);
});

// GET /:proof_id/artifacts/:name - View artifact content
poplRoutes.get('/:proof_id/artifacts/:name', async (c) => {
  const proofId = c.req.param('proof_id');
  const artifactName = c.req.param('name');

  const entry = await getPoplEntry(proofId);

  if (!entry) {
    return c.html(renderPopl404Page(proofId), 404);
  }

  // Find artifact by name
  const artifact = entry.artifacts.find((a) => a.name === artifactName);
  if (!artifact) {
    return c.html(
      renderArtifactPage({
        proofId,
        artifactName,
        connectorId: entry.target_id,
        error: `Artifact "${artifactName}" not found in POPL entry`,
      }),
      404
    );
  }

  // Try to read the artifact file
  const poplDir = join(process.cwd(), '.popl', 'popl_entries', proofId);
  const artifactPath = resolve(poplDir, artifact.path);

  // Security: Prevent path traversal attacks
  const relativePath = relative(poplDir, artifactPath);
  if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
    return c.html(
      renderArtifactPage({
        proofId,
        artifactName,
        connectorId: entry.target_id,
        artifact,
        error: 'Invalid artifact path: access denied',
      }),
      403
    );
  }

  try {
    // Check if file exists and get stats
    const fileStat = await stat(artifactPath);
    const maxSize = 1024 * 1024; // 1MB limit for display

    if (fileStat.size > maxSize) {
      return c.html(
        renderArtifactPage({
          proofId,
          artifactName,
          connectorId: entry.target_id,
          artifact,
          error: `File too large to display (${(fileStat.size / 1024 / 1024).toFixed(2)} MB). Maximum: 1 MB`,
        }),
        200
      );
    }

    const content = await readFile(artifactPath, 'utf-8');

    // Determine content type based on file extension
    const ext = artifact.path.split('.').pop()?.toLowerCase();
    const isJson = ext === 'json' || content.trim().startsWith('{') || content.trim().startsWith('[');

    return c.html(
      renderArtifactPage({
        proofId,
        artifactName,
        connectorId: entry.target_id,
        artifact,
        content,
        isJson,
      })
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return c.html(
      renderArtifactPage({
        proofId,
        artifactName,
        connectorId: entry.target_id,
        artifact,
        error: `Failed to read artifact: ${errorMessage}`,
      }),
      500
    );
  }
});
