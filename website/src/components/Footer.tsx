import { Link } from 'react-router-dom'
import './Footer.css'

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-section">
            <h3 className="footer-title">proofscan</h3>
            <p className="footer-desc">
              Open-source CLI for MCP/A2A Observability. 
              Debug, validate, and audit your Agentic AI systems.
            </p>
            <div className="footer-social">
              <a href="https://github.com/proofofprotocol/proofscan" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a href="https://www.npmjs.com/package/proofscan" target="_blank" rel="noopener noreferrer">
                NPM
              </a>
            </div>
          </div>
          
          <div className="footer-section">
            <h4 className="footer-heading">Documentation</h4>
            <ul className="footer-links">
              <li><Link to="/docs/getting-started">Getting Started</Link></li>
              <li><Link to="/docs/cli-guide">CLI Guide</Link></li>
              <li><Link to="/docs/shell-mode">Shell Mode</Link></li>
              <li><Link to="/docs/proxy">Proxy Server</Link></li>
              <li><Link to="/docs/api-reference">API Reference</Link></li>
            </ul>
          </div>
          
          <div className="footer-section">
            <h4 className="footer-heading">Features</h4>
            <ul className="footer-links">
              <li><Link to="/features#observe">Observe & Analyze</Link></li>
              <li><Link to="/features#proxy">MCP Proxy</Link></li>
              <li><Link to="/features#monitor">Web Monitor</Link></li>
              <li><Link to="/features#popl">Audit Trails</Link></li>
            </ul>
          </div>
          
          <div className="footer-section">
            <h4 className="footer-heading">Resources</h4>
            <ul className="footer-links">
              <li><Link to="/use-cases">Use Cases</Link></li>
              <li><a href="https://github.com/proofofprotocol/proofscan/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog</a></li>
              <li><a href="https://github.com/proofofprotocol/proofscan/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contributing</a></li>
              <li><a href="https://github.com/proofofprotocol/proofscan/issues" target="_blank" rel="noopener noreferrer">Issues</a></li>
            </ul>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>
            © 2026 Proof of Protocol Team. Licensed under MIT.
          </p>
          <p className="footer-version">
            Version 0.11.1
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer
