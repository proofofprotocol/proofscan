/**
 * ProofScan Web Monitor - JSON API routes
 */

import { Hono } from 'hono';
import type { MonitorEnv } from '../server.js';
import { getHomeData, getConnectorDetail } from '../data/connectors.js';
import {
  getPoplEntry,
  getPoplEntriesByConnector,
} from '../data/popl.js';

export const apiRoutes = new Hono<MonitorEnv>();

// GET /api/connectors - List all connectors
apiRoutes.get('/connectors', async (c) => {
  const configPath = c.get('configPath');
  const generatedAt = c.get('generatedAt');

  const homeData = await getHomeData(configPath, generatedAt);
  return c.json({
    generated_at: homeData.generated_at,
    connectors: homeData.connectors,
  });
});

// GET /api/connectors/:id - Connector detail
apiRoutes.get('/connectors/:id', async (c) => {
  const connectorId = c.req.param('id');
  const configPath = c.get('configPath');

  const connector = await getConnectorDetail(configPath, connectorId);

  if (!connector) {
    return c.json({ error: 'Connector not found', connector_id: connectorId }, 404);
  }

  return c.json({
    generated_at: new Date().toISOString(),
    connector,
  });
});

// GET /api/connectors/:id/popl - POPL entries for a connector
apiRoutes.get('/connectors/:id/popl', async (c) => {
  const connectorId = c.req.param('id');
  const entries = await getPoplEntriesByConnector(connectorId);

  return c.json({
    generated_at: new Date().toISOString(),
    connector_id: connectorId,
    entries,
  });
});

// GET /api/popl - POPL KPIs
apiRoutes.get('/popl', async (c) => {
  const configPath = c.get('configPath');
  const generatedAt = c.get('generatedAt');

  const homeData = await getHomeData(configPath, generatedAt);
  return c.json({
    generated_at: homeData.generated_at,
    popl: homeData.popl,
  });
});

// GET /api/popl/:proof_id - POPL entry detail
apiRoutes.get('/popl/:proof_id', async (c) => {
  const proofId = c.req.param('proof_id');
  const entry = await getPoplEntry(proofId);

  if (!entry) {
    return c.json({ error: 'POPL entry not found', proof_id: proofId }, 404);
  }

  return c.json({
    generated_at: new Date().toISOString(),
    entry,
  });
});

// GET /api/popl/:proof_id/download - Download POPL entry as JSON or YAML
apiRoutes.get('/popl/:proof_id/download', async (c) => {
  const proofId = c.req.param('proof_id');
  const format = c.req.query('format') ?? 'json';

  const entry = await getPoplEntry(proofId);

  if (!entry) {
    return c.json({ error: 'POPL entry not found', proof_id: proofId }, 404);
  }

  if (format === 'yaml') {
    try {
      // Dynamic import of yaml package
      const { stringify } = await import('yaml');
      const yamlContent = stringify(entry);
      c.header('Content-Type', 'application/x-yaml');
      c.header('Content-Disposition', `attachment; filename="${proofId}.yaml"`);
      return c.body(yamlContent);
    } catch (err) {
      console.error('YAML serialization failed:', err);
      return c.json({ error: 'YAML serialization failed' }, 500);
    }
  }

  // Default to JSON
  const jsonContent = JSON.stringify(entry, null, 2);
  c.header('Content-Type', 'application/json');
  c.header('Content-Disposition', `attachment; filename="${proofId}.json"`);
  return c.body(jsonContent);
});
