// ProofScan Documentation - Navigation & TOC

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initTOC();
  initSmoothScroll();
  initActiveNavigation();
  initCodeCopy();
});

// Mobile Menu Toggle
function initMobileMenu() {
  const toggle = document.querySelector('.mobile-menu-toggle');
  const sidebar = document.querySelector('.docs-sidebar');
  
  if (!toggle || !sidebar) return;
  
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  
  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
}

// Auto-generate Table of Contents
function initTOC() {
  const content = document.querySelector('.docs-content');
  const toc = document.querySelector('.docs-toc');
  
  if (!content || !toc) return;
  
  // Find all h2 and h3 headings
  const headings = content.querySelectorAll('h2, h3');
  
  if (headings.length === 0) {
    toc.style.display = 'none';
    return;
  }
  
  // Create TOC title
  const tocTitle = document.createElement('div');
  tocTitle.className = 'toc-title';
  tocTitle.textContent = 'On This Page';
  toc.appendChild(tocTitle);
  
  // Create TOC links
  headings.forEach((heading, index) => {
    // Add ID if not present
    if (!heading.id) {
      heading.id = `section-${index}`;
    }
    
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.className = 'toc-link';
    link.textContent = heading.textContent;
    
    // Indent h3
    if (heading.tagName === 'H3') {
      link.style.paddingLeft = '24px';
      link.style.fontSize = '13px';
    }
    
    toc.appendChild(link);
  });
}

// Smooth Scroll
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      
      e.preventDefault();
      const target = document.querySelector(href);
      
      if (target) {
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        
        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// Active Navigation Highlighting
function initActiveNavigation() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('id');
          
          // Update TOC
          document.querySelectorAll('.toc-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('active');
            }
          });
        }
      });
    },
    { rootMargin: '-100px 0px -80% 0px' }
  );
  
  // Observe all headings
  document.querySelectorAll('h2, h3').forEach(heading => {
    if (heading.id) {
      observer.observe(heading);
    }
  });
  
  // Update active sidebar item based on current page
  const currentPath = window.location.pathname;
  document.querySelectorAll('.sidebar-item').forEach(link => {
    const linkPath = new URL(link.href).pathname;
    if (linkPath === currentPath) {
      link.classList.add('active');
    }
  });
}

// Code Copy Functionality
function initCodeCopy() {
  document.querySelectorAll('pre').forEach(pre => {
    const button = document.createElement('button');
    button.className = 'copy-btn';
    button.textContent = 'Copy';
    
    button.addEventListener('click', async () => {
      const code = pre.querySelector('code') || pre;
      const text = code.textContent;
      
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied!';
        button.classList.add('copied');
        
        setTimeout(() => {
          button.textContent = 'Copy';
          button.classList.remove('copied');
        }, 2000);
      } catch (err) {
        button.textContent = 'Failed';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 2000);
      }
    });
    
    pre.style.position = 'relative';
    pre.appendChild(button);
  });
}

// Search functionality (simple client-side)
function initSearch() {
  const searchInput = document.querySelector('.search-input');
  if (!searchInput) return;
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    // TODO: Implement search logic
    console.log('Search query:', query);
  });
}

// Export for use in other scripts
window.ProofScanDocs = {
  initMobileMenu,
  initTOC,
  initSmoothScroll,
  initActiveNavigation,
  initCodeCopy,
  initSearch
};
