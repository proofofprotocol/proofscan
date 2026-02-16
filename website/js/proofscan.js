/**
 * ProofScan Website - Main JavaScript
 */

(function() {
  'use strict';

  // ============================================
  // Theme Management
  // ============================================
  
  const themeToggle = document.getElementById('themeToggle');
  const html = document.documentElement;
  
  // Load saved theme or default to dark
  const savedTheme = localStorage.getItem('proofscan-theme') || 'dark';
  html.setAttribute('data-theme', savedTheme);
  
  if (themeToggle) {
    // Update button text
    updateThemeToggleText(savedTheme);
    
    themeToggle.addEventListener('click', function() {
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      html.setAttribute('data-theme', newTheme);
      localStorage.setItem('proofscan-theme', newTheme);
      updateThemeToggleText(newTheme);
    });
  }
  
  function updateThemeToggleText(theme) {
    if (themeToggle) {
      themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
      themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
  }
  
  // ============================================
  // Mobile Menu
  // ============================================
  
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const headerNav = document.querySelector('.header-nav');
  
  if (mobileMenuToggle && headerNav) {
    mobileMenuToggle.addEventListener('click', function() {
      headerNav.classList.toggle('mobile-open');
      const isOpen = headerNav.classList.contains('mobile-open');
      mobileMenuToggle.textContent = isOpen ? '✕' : '☰';
      mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.header-nav') && !e.target.closest('.mobile-menu-toggle')) {
        headerNav.classList.remove('mobile-open');
        mobileMenuToggle.textContent = '☰';
      }
    });
    
    // Close mobile menu when clicking a link
    const navLinks = headerNav.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', function() {
        headerNav.classList.remove('mobile-open');
        mobileMenuToggle.textContent = '☰';
      });
    });
  }
  
  // ============================================
  // Active Nav Link
  // ============================================
  
  function updateActiveNavLink() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      
      // Check if current path matches link href
      if (currentPath === href || 
          (href !== '/' && currentPath.startsWith(href))) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }
  
  updateActiveNavLink();
  
  // ============================================
  // Code Block Copy
  // ============================================
  
  const copyButtons = document.querySelectorAll('.code-block-copy');
  
  copyButtons.forEach(button => {
    button.addEventListener('click', function() {
      const codeBlock = button.closest('.code-block');
      const code = codeBlock.querySelector('pre code');
      
      if (code) {
        const text = code.textContent;
        
        navigator.clipboard.writeText(text).then(function() {
          const originalText = button.textContent;
          button.textContent = '✓ Copied!';
          button.style.color = 'var(--accent-green)';
          
          setTimeout(function() {
            button.textContent = originalText;
            button.style.color = '';
          }, 2000);
        }).catch(function(err) {
          console.error('Failed to copy:', err);
          button.textContent = '✗ Failed';
          button.style.color = 'var(--accent-red)';
          
          setTimeout(function() {
            button.textContent = '📋 Copy';
            button.style.color = '';
          }, 2000);
        });
      }
    });
  });
  
  // ============================================
  // Smooth Scroll for Anchor Links
  // ============================================
  
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      
      // Ignore empty hash
      if (href === '#') return;
      
      e.preventDefault();
      const target = document.querySelector(href);
      
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
        
        // Update URL without jumping
        history.pushState(null, null, href);
      }
    });
  });
  
  // ============================================
  // Feature Cards Animation on Scroll
  // ============================================
  
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };
  
  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);
  
  // Observe all cards
  document.querySelectorAll('.card').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(card);
  });
  
  // ============================================
  // External Link Indicator
  // ============================================
  
  document.querySelectorAll('a[href^="http"]').forEach(link => {
    if (!link.hostname.includes(window.location.hostname)) {
      link.classList.add('external-link');
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });
  
  // ============================================
  // Console Easter Egg
  // ============================================
  
  console.log('%c🔍 ProofScan', 'font-size: 24px; font-weight: bold; color: #00d4ff;');
  console.log('%cEliminate black boxes. Build trust through transparency.', 'font-size: 12px; color: #8b949e;');
  console.log('%c\nInstall: npm install -g proofscan', 'font-size: 11px; font-family: monospace; color: #e6edf3;');
  console.log('%cDocs: https://github.com/proofofprotocol/proofscan', 'font-size: 11px; font-family: monospace; color: #00d4ff;');
  
})();
