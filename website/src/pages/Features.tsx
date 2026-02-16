import './Features.css'

function Features() {
  return (
    <div className="features-page">
      <section className="page-hero">
        <div className="container">
          <h1>Features</h1>
          <p className="lead">
            Everything you need for MCP/A2A observability, debugging, and validation.
          </p>
        </div>
      </section>

      <section className="container py-5">
        <div id="observe" className="feature-section">
          <h2 className="feature-heading">📊 Observe & Analyze</h2>
          <p className="feature-intro">
            Comprehensive tools for capturing and analyzing MCP protocol communication.
          </p>
          
          <div className="feature-details">
            <div className="feature-detail-card">
              <h3>Automatic Capture</h3>
              <ul>
                <li>Capture all JSON-RPC traffic automatically</li>
                <li>Store in lightweight SQLite database</li>
                <li>EventLine data model for structured queries</li>
                <li>Support for multiple transport types (stdio, HTTP, SSE)</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Powerful CLI</h3>
              <ul>
                <li><code>pfscan view</code> - Timeline of recent events</li>
                <li><code>pfscan tree</code> - Hierarchical connector → session → RPC view</li>
                <li><code>pfscan rpc</code> - Inspect request/response pairs</li>
                <li><code>pfscan analyze</code> - Usage statistics and patterns</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Query & Filter</h3>
              <ul>
                <li>Filter by connector, session, method, time range</li>
                <li>Search across all sessions</li>
                <li>Export to JSON/JSONL for custom analysis</li>
                <li>Flexible retention policies</li>
              </ul>
            </div>
          </div>
        </div>

        <div id="proxy" className="feature-section">
          <h2 className="feature-heading">🎭 MCP Proxy Server</h2>
          <p className="feature-intro">
            Aggregate multiple MCP servers into a single unified endpoint.
          </p>
          
          <div className="feature-details">
            <div className="feature-detail-card">
              <h3>Tool Aggregation</h3>
              <ul>
                <li>Combine tools from multiple backends</li>
                <li>Automatic namespace: <code>connector__tool</code></li>
                <li>Parallel initialization for fast startup</li>
                <li>Graceful handling of partial failures</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Request Routing</h3>
              <ul>
                <li>Parse namespace and route to correct backend</li>
                <li>Strip namespace before forwarding</li>
                <li>Track all communication in events.db</li>
                <li>Support for concurrent requests</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Claude Desktop Integration</h3>
              <ul>
                <li>Single server entry instead of many</li>
                <li>Simplified configuration</li>
                <li>Real-time monitoring via <code>pfscan proxy status</code></li>
                <li>Ring-buffer logging with <code>pfscan log</code></li>
              </ul>
            </div>
          </div>
        </div>

        <div id="monitor" className="feature-section">
          <h2 className="feature-heading">🖥️ Web Monitor</h2>
          <p className="feature-intro">
            Real-time visual dashboard for monitoring protocol events.
          </p>
          
          <div className="feature-details">
            <div className="feature-detail-card">
              <h3>Visual Timeline</h3>
              <ul>
                <li>Color-coded event cards (request/response)</li>
                <li>Timestamp and duration display</li>
                <li>Expandable JSON payloads</li>
                <li>Session and connector grouping</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Wireshark-like Filters</h3>
              <ul>
                <li>DSL for advanced filtering</li>
                <li><code>method == "tools/call"</code></li>
                <li><code>latency &gt; 100</code></li>
                <li><code>connector == "time"</code></li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Real-time Updates</h3>
              <ul>
                <li>Watch events as they happen</li>
                <li>Automatic refresh</li>
                <li>Lightweight read-only interface</li>
                <li>No database locks</li>
              </ul>
            </div>
          </div>
        </div>

        <div id="shell" className="feature-section">
          <h2 className="feature-heading">🐚 Interactive Shell</h2>
          <p className="feature-intro">
            Powerful REPL for exploring and managing sessions.
          </p>
          
          <div className="feature-details">
            <div className="feature-detail-card">
              <h3>Context Management</h3>
              <ul>
                <li><code>cd</code> / <code>cc</code> - Navigate connectors/sessions</li>
                <li><code>pwd</code> - Show current context</li>
                <li><code>ls</code> - List items in current context</li>
                <li><code>show</code> - Display details</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>@References</h3>
              <ul>
                <li><code>@this</code> - Current context</li>
                <li><code>@last</code> - Latest session/RPC</li>
                <li><code>@rpc:&lt;id&gt;</code> - Specific RPC</li>
                <li><code>@ref:&lt;name&gt;</code> - Named reference</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>TAB Completion</h3>
              <ul>
                <li>Command completion</li>
                <li>Connector ID completion</li>
                <li>Session ID completion</li>
                <li>Reference name completion</li>
              </ul>
            </div>
          </div>
        </div>

        <div id="popl" className="feature-section">
          <h2 className="feature-heading">🔒 Audit Trails (POPL)</h2>
          <p className="feature-intro">
            Public Observable Proof Ledger - Generate safe audit trails.
          </p>
          
          <div className="feature-details">
            <div className="feature-detail-card">
              <h3>Automatic Sanitization</h3>
              <ul>
                <li>Redact secrets (API keys, tokens, passwords)</li>
                <li>Redact file paths (absolute and relative)</li>
                <li>Hash RPC payloads (SHA-256)</li>
                <li>Remove PII</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Structured Output</h3>
              <ul>
                <li><code>POPL.yml</code> - Entry metadata with artifact hashes</li>
                <li><code>status.json</code> - Session summary</li>
                <li><code>rpc.sanitized.jsonl</code> - Event timeline</li>
                <li><code>validation-run.log</code> - Generation log</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Trust Levels</h3>
              <ul>
                <li>Level 0: Recorded (captured data)</li>
                <li>Level 1: Verified (manual review)</li>
                <li>Level 2: Attested (cryptographic proof)</li>
                <li>Extensible trust framework</li>
              </ul>
            </div>
          </div>
        </div>

        <div id="plans" className="feature-section">
          <h2 className="feature-heading">✅ Validation Plans</h2>
          <p className="feature-intro">
            Define and run reproducible validation scenarios.
          </p>
          
          <div className="feature-details">
            <div className="feature-detail-card">
              <h3>YAML Definitions</h3>
              <ul>
                <li>Declarative plan syntax</li>
                <li>Conditional steps with <code>when</code></li>
                <li>Built-in MCP method support</li>
                <li>Custom tool calls</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Plan Execution</h3>
              <ul>
                <li><code>pfscan plans run</code> - Execute plan</li>
                <li>Step-by-step results</li>
                <li>Inventory collection (tools, resources, prompts)</li>
                <li>Artifact generation</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Reusable & Shareable</h3>
              <ul>
                <li>Import/export plans</li>
                <li>Built-in plan library (basic-mcp, full-mcp)</li>
                <li>Multi-document YAML support</li>
                <li>Version control friendly</li>
              </ul>
            </div>
          </div>
        </div>

        <div id="mcp-apps" className="feature-section">
          <h2 className="feature-heading">🎨 MCP Apps UI</h2>
          <p className="feature-intro">
            Interactive UI extensions within Claude Desktop.
          </p>
          
          <div className="feature-details">
            <div className="feature-detail-card">
              <h3>Trace Viewer</h3>
              <ul>
                <li>Visual timeline of protocol events</li>
                <li>Expandable JSON payloads</li>
                <li>Scroll-to-load pagination</li>
                <li>Real-time notifications</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>Security Model</h3>
              <ul>
                <li>Token isolation (never sent to server)</li>
                <li>Four correlation IDs for traceability</li>
                <li>Sandboxed iframe execution</li>
                <li>Content Security Policy (CSP)</li>
              </ul>
            </div>
            
            <div className="feature-detail-card">
              <h3>proofscan_getEvents Tool</h3>
              <ul>
                <li>Paginated event retrieval</li>
                <li>Three-layer response (content, structured, meta)</li>
                <li>Cursor-based navigation</li>
                <li>Size limits and secret redaction</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Features
