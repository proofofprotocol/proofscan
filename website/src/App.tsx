import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import Features from './pages/Features'
import Docs from './pages/Docs'
import UseCases from './pages/UseCases'

function App() {
  return (
    <div className="app">
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/features" element={<Features />} />
          <Route path="/docs/*" element={<Docs />} />
          <Route path="/use-cases" element={<UseCases />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}

export default App
