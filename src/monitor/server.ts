/**
 * ProofScan Web Monitor - Hono Server
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import type { MonitorServerOptions } from './types.js';
import { registerRoutes } from './routes/index.js';

/**
 * Context variables available in all routes
 */
export type MonitorEnv = {
  Variables: {
    configPath: string;
    generatedAt: string;
  };
};

/**
 * Create the Hono application with all routes
 */
export function createMonitorApp(options: MonitorServerOptions): Hono<MonitorEnv> {
  const app = new Hono<MonitorEnv>();

  // Middleware: inject context into all requests
  app.use('*', async (c, next) => {
    c.set('configPath', options.configPath);
    c.set('generatedAt', new Date().toISOString());
    await next();
  });

  // Register all routes
  registerRoutes(app);

  return app;
}

/**
 * Start the monitor server
 */
export function startMonitorServer(
  options: MonitorServerOptions
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = createMonitorApp(options);

    const server = serve(
      {
        fetch: app.fetch,
        port: options.port,
        hostname: options.host,
      },
      (info) => {
        console.log(`ProofScan Monitor running at http://${info.address}:${info.port}`);
        console.log('  Mode: Offline (read-only)');
        console.log('  Press Ctrl+C to stop');
        console.log('');
        resolve(server as unknown as Server);
      }
    );

    // Handle server errors (e.g., EADDRINUSE)
    (server as unknown as Server).on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Error: Port ${options.port} is already in use`);
        console.error(`Try a different port with: pfs monitor start --port <port>`);
        reject(err);
      } else {
        reject(err);
      }
    });
  });
}
