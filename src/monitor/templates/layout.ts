/**
 * ProofScan Web Monitor - Base HTML layout
 */

/**
 * Get base CSS styles (dark theme matching existing HTML export)
 */
export function getBaseStyles(): string {
  return `
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border-color: #30363d;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --accent-blue: #00d4ff;
      --accent-green: #3fb950;
      --accent-yellow: #d29922;
      --accent-red: #f85149;
      --accent-gray: #6e7681;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-primary);
      background: var(--bg-primary);
      min-height: 100vh;
    }

    a {
      color: var(--accent-blue);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    .header-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .header-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .offline-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .offline-badge::before {
      content: '';
      width: 6px;
      height: 6px;
      background: var(--accent-gray);
      border-radius: 50%;
    }

    /* Main container */
    .main {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }

    /* Section */
    .section {
      margin-bottom: 24px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    /* Badge styles */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .badge-ok { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); border: 1px solid rgba(63, 185, 80, 0.3); }
    .badge-warn { background: rgba(210, 153, 34, 0.15); color: var(--accent-yellow); border: 1px solid rgba(210, 153, 34, 0.3); }
    .badge-err { background: rgba(248, 81, 73, 0.15); color: var(--accent-red); border: 1px solid rgba(248, 81, 73, 0.3); }
    .badge-offline { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); }
    .badge-enabled { background: rgba(63, 185, 80, 0.1); color: var(--accent-green); border: 1px solid rgba(63, 185, 80, 0.2); }
    .badge-disabled { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); }
    .badge-capability { background: rgba(0, 212, 255, 0.1); color: var(--accent-blue); border: 1px solid rgba(0, 212, 255, 0.2); }
    .badge-transport { background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); }
  `;
}

/**
 * Render base HTML layout
 */
export function renderLayout(options: {
  title: string;
  generatedAt: string;
  content: string;
  extraStyles?: string;
  scripts?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  <style>
${getBaseStyles()}
${options.extraStyles ?? ''}
  </style>
</head>
<body>
  <header class="header">
    <div class="header-title">ProofScan Monitor</div>
    <div class="header-meta">
      <span class="offline-badge">Offline</span>
      <span>Generated: ${formatTimestamp(options.generatedAt)}</span>
    </div>
  </header>
  <main class="main">
${options.content}
  </main>
${options.scripts ? `<script>${options.scripts}</script>` : ''}
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString();
  } catch {
    return iso;
  }
}
