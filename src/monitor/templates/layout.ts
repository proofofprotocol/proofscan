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

    /* Auto-check toggle (Phase 12.1) */
    .auto-check-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 2px 4px;
    }

    .auto-check-toggle .auto-check-label {
      font-size: 10px;
      color: var(--text-secondary);
      padding-left: 4px;
    }

    .auto-check-toggle button {
      background: transparent;
      border: none;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .auto-check-toggle button:hover {
      color: var(--text-primary);
    }

    .auto-check-toggle button.active {
      background: rgba(0, 212, 255, 0.15);
      color: var(--accent-blue);
    }

    /* New data banner (Phase 12.1) */
    .new-data-banner {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: rgba(0, 212, 255, 0.15);
      border: 1px solid var(--accent-blue);
      border-radius: 12px;
      font-size: 11px;
      color: var(--accent-blue);
    }

    .new-data-banner.active {
      display: inline-flex;
    }

    .new-data-banner button {
      background: var(--accent-blue);
      border: none;
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 10px;
      color: var(--bg-primary);
      cursor: pointer;
    }

    .new-data-banner button:hover {
      opacity: 0.9;
    }

    /* External link indicator */
    .external-link::after {
      content: ' ↗';
      font-size: 0.8em;
      opacity: 0.7;
    }

    /* Modal Overlay */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(13, 17, 23, 0.85);
      z-index: 1000;
      overflow-y: auto;
      padding: 24px;
    }

    .modal-overlay.active {
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }

    .modal-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      max-width: 900px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
      margin-top: 40px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      position: sticky;
      top: 0;
      background: var(--bg-secondary);
      z-index: 1;
    }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-entry-id {
      font-family: 'SF Mono', Consolas, monospace;
      color: var(--accent-blue);
    }

    .modal-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
    }

    .modal-menu-btn {
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 4px 8px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 14px;
    }

    .modal-menu-btn:hover {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    .modal-close-btn {
      background: transparent;
      border: none;
      padding: 4px 8px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
    }

    .modal-close-btn:hover {
      color: var(--accent-red);
    }

    .modal-content {
      padding: 20px;
    }

    /* Modal dropdown menu */
    .modal-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 4px 0;
      min-width: 180px;
      display: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 2;
    }

    .modal-dropdown.active {
      display: block;
    }

    .modal-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      color: var(--text-primary);
      text-decoration: none;
      font-size: 13px;
      cursor: pointer;
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
    }

    .modal-dropdown-item:hover {
      background: rgba(0, 212, 255, 0.1);
      color: var(--accent-blue);
    }

    .modal-dropdown-divider {
      height: 1px;
      background: var(--border-color);
      margin: 4px 0;
    }

    .modal-error {
      padding: 24px;
      text-align: center;
      color: var(--accent-red);
    }

    .modal-error-message {
      margin-bottom: 12px;
    }

    .modal-retry-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .modal-retry-btn:hover {
      background: var(--bg-primary);
    }

    .modal-loading {
      padding: 48px 24px;
      text-align: center;
      color: var(--text-secondary);
    }
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
  dataPage?: string;
  dataApp?: string; // 'monitor' for monitor pages (Phase 12.1)
}): string {
  const mainAttrs = options.dataPage ? ` data-page="${escapeHtml(options.dataPage)}"` : '';
  const bodyAttrs = options.dataApp ? ` data-app="${escapeHtml(options.dataApp)}"` : '';
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
<body${bodyAttrs}>
  <header class="header">
    <div class="header-title">ProofScan Monitor</div>
    <div class="header-meta">
      <div class="auto-check-toggle" id="autoCheckToggle">
        <span class="auto-check-label">Auto-check:</span>
        <button data-enabled="false" class="active">OFF</button>
        <button data-enabled="true">ON</button>
      </div>
      <div class="new-data-banner" id="newDataBanner">
        <span>New data available</span>
        <button id="refreshNowBtn">Refresh now</button>
      </div>
      <span class="offline-badge">Offline</span>
      <span>Generated: ${formatTimestamp(options.generatedAt)}</span>
    </div>
  </header>
  <main class="main"${mainAttrs}>
${options.content}
  </main>
<script>${getAutoCheckScript()}</script>
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

/**
 * Get auto-check script (Phase 12.1)
 * Polls /api/monitor/summary for changes and shows banner instead of auto-reload
 */
function getAutoCheckScript(): string {
  return `
(function() {
  // CRITICAL: Only run on monitor pages (not embedded HTML export)
  if (!document.body.dataset.app || document.body.dataset.app !== 'monitor') {
    return;
  }

  var checkInterval = null;
  var lastDigest = null;
  var newDataDetected = false;
  var INTERVAL_MS = 10000;

  var toggle = document.getElementById('autoCheckToggle');
  var banner = document.getElementById('newDataBanner');
  var refreshBtn = document.getElementById('refreshNowBtn');
  if (!toggle) return;

  var buttons = toggle.querySelectorAll('button');
  var enabled = localStorage.getItem('proofscan-auto-check') === 'true';

  // Initial state
  buttons.forEach(function(btn) {
    btn.classList.toggle('active', (btn.dataset.enabled === 'true') === enabled);
  });
  if (enabled) startChecking();

  function startChecking() {
    checkForUpdates(); // First check
    checkInterval = setInterval(checkForUpdates, INTERVAL_MS);
  }

  function stopChecking() {
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = null;
  }

  function checkForUpdates() {
    if (newDataDetected) return; // Banner already shown
    fetch('/api/monitor/summary')
      .then(function(res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function(data) {
        if (!data) return;
        if (lastDigest === null) {
          lastDigest = data.digest; // Baseline
        } else if (data.digest !== lastDigest) {
          newDataDetected = true;
          banner.classList.add('active');
        }
      })
      .catch(function() { /* ignore */ });
  }

  buttons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var on = btn.dataset.enabled === 'true';
      localStorage.setItem('proofscan-auto-check', String(on));
      buttons.forEach(function(b) {
        b.classList.toggle('active', (b.dataset.enabled === 'true') === on);
      });
      if (on) {
        startChecking();
      } else {
        stopChecking();
        banner.classList.remove('active');
        newDataDetected = false;
      }
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      location.reload();
    });
  }
})();
  `;
}
