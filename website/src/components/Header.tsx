import { Link, useLocation } from 'react-router-dom'
import './Header.css'

function Header() {
  const location = useLocation()
  
  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  return (
    <header className="header">
      <nav className="container">
        <div className="nav-brand">
          <Link to="/" className="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="6" fill="#0066cc"/>
              <path d="M8 12h16M8 16h16M8 20h12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="logo-text">proofscan</span>
          </Link>
        </div>
        
        <ul className="nav-links">
          <li>
            <Link 
              to="/features" 
              className={`nav-link ${isActive('/features') ? 'active' : ''}`}
            >
              Features
            </Link>
          </li>
          <li>
            <Link 
              to="/docs" 
              className={`nav-link ${isActive('/docs') ? 'active' : ''}`}
            >
              Docs
            </Link>
          </li>
          <li>
            <Link 
              to="/use-cases" 
              className={`nav-link ${isActive('/use-cases') ? 'active' : ''}`}
            >
              Use Cases
            </Link>
          </li>
          <li>
            <a 
              href="https://github.com/proofofprotocol/proofscan" 
              className="nav-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </li>
        </ul>
        
        <div className="nav-actions">
          <a 
            href="https://www.npmjs.com/package/proofscan"
            className="btn btn-secondary btn-small"
            target="_blank"
            rel="noopener noreferrer"
          >
            Install
          </a>
        </div>
      </nav>
    </header>
  )
}

export default Header
