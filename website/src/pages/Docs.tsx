import { Routes, Route, Link, useLocation } from 'react-router-dom'
import './Docs.css'

// ドキュメントページコンポーネント（個別）
import GettingStarted from './docs/GettingStarted'
import CliGuide from './docs/CliGuide'
import ShellMode from './docs/ShellMode'
import ProxyGuide from './docs/ProxyGuide'
import MonitorGuide from './docs/MonitorGuide'
import McpAppsGuide from './docs/McpAppsGuide'
import PoplGuide from './docs/PoplGuide'
import PlansGuide from './docs/PlansGuide'
import ApiReference from './docs/ApiReference'
import Architecture from './docs/Architecture'

function Docs() {
  const location = useLocation()
  
  const isActive = (path: string) => {
    return location.pathname === path || location.pathname === `/docs${path}`
  }

  return (
    <div className="docs-page">
      <div className="docs-container">
        <aside className="docs-sidebar">
          <nav className="docs-nav">
            <h3 className="docs-nav-title">Documentation</h3>
            
            <div className="docs-nav-section">
              <h4 className="docs-nav-heading">Getting Started</h4>
              <ul className="docs-nav-list">
                <li>
                  <Link 
                    to="/docs/getting-started" 
                    className={`docs-nav-link ${isActive('/getting-started') ? 'active' : ''}`}
                  >
                    Quick Start
                  </Link>
                </li>
              </ul>
            </div>
            
            <div className="docs-nav-section">
              <h4 className="docs-nav-heading">Core Features</h4>
              <ul className="docs-nav-list">
                <li>
                  <Link 
                    to="/docs/cli-guide" 
                    className={`docs-nav-link ${isActive('/cli-guide') ? 'active' : ''}`}
                  >
                    CLI Guide
                  </Link>
                </li>
                <li>
                  <Link 
                    to="/docs/shell-mode" 
                    className={`docs-nav-link ${isActive('/shell-mode') ? 'active' : ''}`}
                  >
                    Shell Mode
                  </Link>
                </li>
                <li>
                  <Link 
                    to="/docs/proxy" 
                    className={`docs-nav-link ${isActive('/proxy') ? 'active' : ''}`}
                  >
                    Proxy Server
                  </Link>
                </li>
                <li>
                  <Link 
                    to="/docs/monitor" 
                    className={`docs-nav-link ${isActive('/monitor') ? 'active' : ''}`}
                  >
                    Web Monitor
                  </Link>
                </li>
              </ul>
            </div>
            
            <div className="docs-nav-section">
              <h4 className="docs-nav-heading">Advanced</h4>
              <ul className="docs-nav-list">
                <li>
                  <Link 
                    to="/docs/mcp-apps" 
                    className={`docs-nav-link ${isActive('/mcp-apps') ? 'active' : ''}`}
                  >
                    MCP Apps UI
                  </Link>
                </li>
                <li>
                  <Link 
                    to="/docs/popl" 
                    className={`docs-nav-link ${isActive('/popl') ? 'active' : ''}`}
                  >
                    Audit Trails (POPL)
                  </Link>
                </li>
                <li>
                  <Link 
                    to="/docs/plans" 
                    className={`docs-nav-link ${isActive('/plans') ? 'active' : ''}`}
                  >
                    Validation Plans
                  </Link>
                </li>
              </ul>
            </div>
            
            <div className="docs-nav-section">
              <h4 className="docs-nav-heading">Reference</h4>
              <ul className="docs-nav-list">
                <li>
                  <Link 
                    to="/docs/api-reference" 
                    className={`docs-nav-link ${isActive('/api-reference') ? 'active' : ''}`}
                  >
                    API Reference
                  </Link>
                </li>
                <li>
                  <Link 
                    to="/docs/architecture" 
                    className={`docs-nav-link ${isActive('/architecture') ? 'active' : ''}`}
                  >
                    Architecture
                  </Link>
                </li>
              </ul>
            </div>
          </nav>
        </aside>
        
        <main className="docs-content">
          <Routes>
            <Route index element={<GettingStarted />} />
            <Route path="getting-started" element={<GettingStarted />} />
            <Route path="cli-guide" element={<CliGuide />} />
            <Route path="shell-mode" element={<ShellMode />} />
            <Route path="proxy" element={<ProxyGuide />} />
            <Route path="monitor" element={<MonitorGuide />} />
            <Route path="mcp-apps" element={<McpAppsGuide />} />
            <Route path="popl" element={<PoplGuide />} />
            <Route path="plans" element={<PlansGuide />} />
            <Route path="api-reference" element={<ApiReference />} />
            <Route path="architecture" element={<Architecture />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default Docs
