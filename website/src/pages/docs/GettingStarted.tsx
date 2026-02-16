function GettingStarted() {
  return (
    <div>
      <h1>Getting Started</h1>
      <p>
        Get up and running with proofscan in minutes. This guide will walk you through installation, basic configuration, and your first scan.
      </p>

      <h2>Installation</h2>
      <h3>Global Installation (Recommended)</h3>
      <pre><code>{`npm install -g proofscan`}</code></pre>
      <p>This installs proofscan globally, making the <code>pfscan</code> command available everywhere.</p>

      <h3>Run Without Installing</h3>
      <pre><code>{`npx proofscan --help`}</code></pre>
      <p>Use <code>npx</code> to run proofscan without installing. Great for trying it out.</p>

      <h3>Requirements</h3>
      <ul>
        <li><strong>Node.js</strong> v18+ (v20+ recommended)</li>
        <li><strong>npm</strong> v7+ or equivalent package manager</li>
      </ul>

      <h3>Verify Installation</h3>
      <pre><code>{`pfscan --version
# Output: 0.11.1`}</code></pre>

      <h2>Quick Start</h2>
      <p>Let's scan your first MCP server in 3 steps:</p>

      <h3>Step 1: Initialize Configuration</h3>
      <pre><code>{`pfscan config init`}</code></pre>
      <p>This creates a configuration file in an OS-appropriate location:</p>
      <ul>
        <li><strong>Linux:</strong> <code>~/.config/proofscan/config.json</code></li>
        <li><strong>macOS:</strong> <code>~/Library/Application Support/proofscan/config.json</code></li>
        <li><strong>Windows:</strong> <code>%APPDATA%\\proofscan\\config.json</code></li>
      </ul>

      <h3>Step 2: Add an MCP Server</h3>
      <p>Option A: Import from Claude Desktop config:</p>
      <pre><code>{`# macOS
cat ~/Library/Application\\ Support/Claude/claude_desktop_config.json \\
  | pfscan connectors import --from mcpServers --stdin

# Windows
type %APPDATA%\\Claude\\claude_desktop_config.json \\
  | pfscan connectors import --from mcpServers --stdin`}</code></pre>

      <p>Option B: Add manually:</p>
      <pre><code>{`pfscan connectors add time --stdio "npx -y @modelcontextprotocol/server-time"`}</code></pre>

      <p>Option C: Install from catalog:</p>
      <pre><code>{`# Search catalog
pfscan catalog search weather

# Install server
pfscan catalog install io.github.AlexDeMichieli/weather`}</code></pre>

      <h3>Step 3: Run Your First Scan</h3>
      <pre><code>{`pfscan scan start --id time`}</code></pre>
      <p>Output:</p>
      <pre><code>{`Scanning connector 'time'...
✓ Session started
✓ Initialized (269ms)
✓ Found 2 tools
✓ Scan complete (2.5s)

Session ID: f2442c9b...
hint: pfscan tree time`}</code></pre>

      <h2>View Your Results</h2>
      <h3>Timeline View</h3>
      <pre><code>{`pfscan view`}</code></pre>
      <p>Shows recent events in a timeline:</p>
      <pre><code>{`Time         Sym Dir St Method              Session      Extra
-------------------------------------------------------------------
21:01:58.743 → → ✓ initialize            f2442c... lat=269ms
21:01:59.018 ← ← ✓ initialize            f2442c...
21:01:59.037 → → ✓ tools/list            f2442c...
21:01:59.049 ← ← ✓ tools/list            f2442c... lat=12ms size=1.0KB`}</code></pre>

      <h3>Tree View</h3>
      <pre><code>{`pfscan tree time`}</code></pre>
      <p>Shows hierarchical structure:</p>
      <pre><code>{`└── 📦 time
    └── 📋 f2442c9b... (2 rpcs, 8 events)
        ├── ↔️ ✓ tools/list (id=2, 12ms)
        └── ↔️ ✓ initialize (id=1, 269ms)`}</code></pre>

      <h3>Detailed RPC Inspection</h3>
      <pre><code>{`pfscan rpc show --session f2442c --id 2`}</code></pre>

      <h2>Next Steps</h2>
      <div className="grid grid-2">
        <a href="/docs/cli-guide" className="card">
          <h3>📘 CLI Guide</h3>
          <p>Complete command reference with examples</p>
        </a>
        
        <a href="/docs/shell-mode" className="card">
          <h3>🐚 Shell Mode</h3>
          <p>Interactive REPL with TAB completion</p>
        </a>
        
        <a href="/docs/proxy" className="card">
          <h3>🎭 MCP Proxy</h3>
          <p>Aggregate multiple servers</p>
        </a>
        
        <a href="/docs/monitor" className="card">
          <h3>🖥️ Web Monitor</h3>
          <p>Real-time visual dashboard</p>
        </a>
      </div>

      <h2>Common Workflows</h2>
      <h3>Debug a Failing Tool</h3>
      <pre><code>{`# Scan server
pfscan scan start --id myserver

# View only errors
pfscan view --connector myserver --errors

# Inspect failing RPC
pfscan rpc show --session abc123 --id 5`}</code></pre>

      <h3>Monitor in Real-Time</h3>
      <pre><code>{`# Terminal 1: Start proxy
pfscan proxy start --all

# Terminal 2: Monitor
pfscan log --tail 20
watch -n 2 pfscan proxy status

# Terminal 3: Use Web Monitor
pfscan monitor start
# Open http://localhost:3030`}</code></pre>

      <h3>Create Audit Trail</h3>
      <pre><code>{`# Initialize POPL
pfscan popl init

# After scan, create entry
pfscan popl session --session abc123 \\
  --title "Production Test" \\
  --description "Testing payment tool"

# Safe to share - secrets/paths redacted
ls .popl/entries/20260216-abc123/`}</code></pre>

      <h2>Configuration</h2>
      <h3>View Current Config</h3>
      <pre><code>{`pfscan config show`}</code></pre>

      <h3>Edit Configuration</h3>
      <pre><code>{`pfscan config path    # Show config location
pfscan config edit    # Open in default editor`}</code></pre>

      <h3>Configuration Structure</h3>
      <pre><code>{`{
  "version": 1,
  "connectors": [
    {
      "id": "time",
      "enabled": true,
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-time"]
      }
    }
  ],
  "retention": {
    "keep_last_sessions": 50,
    "raw_days": 7,
    "max_db_mb": 500
  }
}`}</code></pre>

      <h2>Troubleshooting</h2>
      <h3>Database Issues</h3>
      <pre><code>{`# Check database health
pfscan doctor

# Fix issues
pfscan doctor --fix`}</code></pre>

      <h3>Connector Not Working</h3>
      <pre><code>{`# Verify connector config
pfscan connectors show --id myserver

# Test manually
pfscan scan start --id myserver --timeout 60

# Check for errors
pfscan view --connector myserver --errors`}</code></pre>

      <h2>Help & Resources</h2>
      <ul>
        <li><strong>CLI Help:</strong> <code>pfscan --help</code></li>
        <li><strong>Command Help:</strong> <code>pfscan &lt;command&gt; --help</code></li>
        <li><strong>GitHub:</strong> <a href="https://github.com/proofofprotocol/proofscan" target="_blank" rel="noopener noreferrer">github.com/proofofprotocol/proofscan</a></li>
        <li><strong>Issues:</strong> <a href="https://github.com/proofofprotocol/proofscan/issues" target="_blank" rel="noopener noreferrer">Report bugs or request features</a></li>
        <li><strong>NPM:</strong> <a href="https://www.npmjs.com/package/proofscan" target="_blank" rel="noopener noreferrer">npmjs.com/package/proofscan</a></li>
      </ul>
    </div>
  )
}

export default GettingStarted
