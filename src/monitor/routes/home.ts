/**
 * ProofScan Web Monitor - Home page route
 */

import { Hono } from 'hono';
import type { MonitorEnv } from '../server.js';
import { renderHomePage } from '../templates/home.js';
import { getHomeData } from '../data/connectors.js';

export const homeRoutes = new Hono<MonitorEnv>();

homeRoutes.get('/', async (c) => {
  const configPath = c.get('configPath');
  const generatedAt = c.get('generatedAt');

  const homeData = await getHomeData(configPath, generatedAt);
  const html = renderHomePage(homeData);

  return c.html(html);
});
