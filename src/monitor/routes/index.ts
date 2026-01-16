/**
 * ProofScan Web Monitor - Route registration
 */

import type { Hono } from 'hono';
import type { MonitorEnv } from '../server.js';
import { homeRoutes } from './home.js';
import { connectorsRoutes } from './connectors.js';
import { apiRoutes } from './api.js';
import { poplRoutes } from './popl.js';

/**
 * Register all routes on the app
 */
export function registerRoutes(app: Hono<MonitorEnv>): void {
  // HTML routes
  app.route('/', homeRoutes);
  app.route('/connectors', connectorsRoutes);
  app.route('/popl', poplRoutes);

  // JSON API routes
  app.route('/api', apiRoutes);
}
