import { Link } from 'react-router-dom'
import './Home.css'

function Home() {
  return (
    <div className="home">
      {/* Hero Section */}
      <section className="hero">
        <div className="container text-center">
          <h1 className="hero-title">
            MCP/A2A Observability
            <br />
            <span className="hero-highlight">Made Simple</span>
          </h1>
          <p className="hero-subtitle">
            Open-source CLI and shell for debugging, validating, and auditing your Agentic AI systems.
            <br />
            Capture, analyze, and visualize Model Context Protocol & Agent-to-Agent communication.
          </p>
          <div className="hero-actions">
            <Link to="/docs/getting-started" className="btn btn-primary btn-large">
              Get Started
            </Link>
            <a 
              href="https://github.com/proofofprotocol/proofscan" 
              className="btn btn-secondary btn-large"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
          </div>
          <div className="hero-install">
            <code>npm install -g proofscan</code>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section features-section">
        <div className="container">
          <h2 className="section-title text-center">Key Features</h2>
          <div className="grid grid-3">
            <div className="feature-card">
              <div className="feature-icon">📊</div>
              <h3 className="feature-title">Capture & Analyze</h3>
              <p className="feature-desc">
                Automatically capture all MCP JSON-RPC traffic. Store, query, and analyze protocol events with a powerful CLI.
              </p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">🎭</div>
              <h3 className="feature-title">MCP Proxy</h3>
              <p className="feature-desc">
                Aggregate multiple MCP servers into one. Namespace tools, route calls, and record all communication seamlessly.
              </p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">🖥️</div>
              <h3 className="feature-title">Web Monitor</h3>
              <p className="feature-desc">
                Real-time visual dashboard with Wireshark-like filters. Monitor protocol events as they happen.
              </p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">🔒</div>
              <h3 className="feature-title">Audit Trails (POPL)</h3>
              <p className="feature-desc">
                Generate public-safe audit trails. Automatic sanitization of secrets, paths, and sensitive data.
              </p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">🐚</div>
              <h3 className="feature-title">Interactive Shell</h3>
              <p className="feature-desc">
                Powerful REPL with TAB completion, context management, @references, and pipe support.
              </p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">✅</div>
              <h3 className="feature-title">Validation Plans</h3>
              <p className="feature-desc">
                Define YAML validation scenarios. Run reproducible tests against your MCP servers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CLI Demo Section */}
      <section className="section cli-demo-section">
        <div className="container">
          <h2 className="section-title text-center">Simple, Powerful CLI</h2>
          <div className="cli-demo">
            <div className="cli-window">
              <div className="cli-header">
                <span className="cli-dot"></span>
                <span className="cli-dot"></span>
                <span className="cli-dot"></span>
              </div>
              <div className="cli-body">
                <div className="cli-line">
                  <span className="cli-prompt">$</span>
                  <span className="cli-command">pfscan scan start --id time</span>
                </div>
                <div className="cli-output">
                  Scanning connector 'time'...
                  <br />✓ Session started
                  <br />✓ Found 2 tools
                  <br />✓ Scan complete (2.5s)
                </div>
                <div className="cli-line mt-2">
                  <span className="cli-prompt">$</span>
                  <span className="cli-command">pfscan view</span>
                </div>
                <div className="cli-output">
                  Time         Sym Dir St Method              Session      Extra
                  <br />-------------------------------------------------------------------
                  <br />21:01:58.743 → → ✓ initialize            f2442c... lat=269ms
                  <br />21:01:59.037 → → ✓ tools/list            f2442c... lat=12ms size=1.0KB
                </div>
              </div>
            </div>
          </div>
          <div className="text-center mt-4">
            <Link to="/docs/cli-guide" className="btn btn-primary">
              View CLI Documentation
            </Link>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="section use-cases-section">
        <div className="container">
          <h2 className="section-title text-center">Built for Real-World Needs</h2>
          <div className="grid grid-2">
            <div className="use-case-card">
              <h3>🔍 Debug AI Integrations</h3>
              <p>
                Trace every request and response. Identify failures, inspect payloads, and understand tool execution flow.
              </p>
            </div>
            
            <div className="use-case-card">
              <h3>📈 Analyze Performance</h3>
              <p>
                Track latency, measure throughput, and identify bottlenecks in your MCP server infrastructure.
              </p>
            </div>
            
            <div className="use-case-card">
              <h3>🛡️ Security & Compliance</h3>
              <p>
                Generate sanitized audit trails for compliance. Track tool usage and permissions without exposing secrets.
              </p>
            </div>
            
            <div className="use-case-card">
              <h3>🧪 Test & Validate</h3>
              <p>
                Create validation plans to ensure your MCP servers work correctly. Run reproducible integration tests.
              </p>
            </div>
          </div>
          <div className="text-center mt-4">
            <Link to="/use-cases" className="btn btn-secondary">
              Explore Use Cases
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section cta-section">
        <div className="container text-center">
          <h2 className="cta-title">Ready to Start?</h2>
          <p className="cta-subtitle">
            Install proofscan now and gain instant observability into your Agentic AI systems.
          </p>
          <div className="cta-actions">
            <Link to="/docs/getting-started" className="btn btn-primary btn-large">
              Get Started
            </Link>
            <Link to="/docs" className="btn btn-secondary btn-large">
              Read Documentation
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Home
