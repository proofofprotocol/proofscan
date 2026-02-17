console.log('main-simple.js loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded!');
  
  const content = document.querySelector('.docs-content');
  const toc = document.querySelector('.toc-sidebar');
  
  console.log('content:', content);
  console.log('toc:', toc);
  
  if (!content || !toc) {
    console.log('Missing elements, exiting');
    return;
  }
  
  const headings = content.querySelectorAll('h2, h3');
  console.log('headings:', headings.length);
  
  if (headings.length === 0) {
    toc.style.display = 'none';
    return;
  }
  
  const tocTitle = document.createElement('div');
  tocTitle.className = 'toc-title';
  tocTitle.textContent = 'On This Page';
  toc.appendChild(tocTitle);
  
  headings.forEach((heading, index) => {
    if (!heading.id) {
      heading.id = `section-${index}`;
    }
    
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.className = 'toc-link';
    link.textContent = heading.textContent;
    
    if (heading.tagName === 'H3') {
      link.style.paddingLeft = '24px';
      link.style.fontSize = '13px';
    }
    
    toc.appendChild(link);
  });
  
  console.log('TOC generated successfully!');
});
