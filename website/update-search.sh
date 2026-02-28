#!/bin/bash

# Update all HTML files to use Pagefind search

echo "🔍 Updating search functionality in all HTML files..."

# Function to update a single HTML file
update_search() {
  local file="$1"
  
  # Skip if file doesn't exist or is empty
  if [[ ! -f "$file" ]] || [[ ! -s "$file" ]]; then
    return
  fi
  
  # Check if file already has pagefind
  if grep -q "pagefind-ui.css" "$file"; then
    echo "  ⏭️  $file already updated"
    return
  fi
  
  echo "  📝 Updating $file..."
  
  # Add Pagefind CSS before </head>
  sed -i 's|</head>|  <link href="/pagefind/pagefind-ui.css" rel="stylesheet">\n</head>|' "$file"
  
  # Replace search-bar div with pagefind wrapper
  sed -i 's|<div class="search-bar">|<div class="search-wrapper">|' "$file"
  sed -i 's|<span class="search-icon">🔍</span>||' "$file"
  sed -i 's|<input type="search" class="search-input" placeholder="Search docs...">|<div id="search"></div>|' "$file"
  sed -i 's|</div><!-- End search-bar -->|</div><!-- End search-wrapper -->|' "$file"
  
  # Add Pagefind JS and initialization before </body>
  if ! grep -q "pagefind-ui.js" "$file"; then
    sed -i 's|</body>|  <script src="/pagefind/pagefind-ui.js"></script>\n  <script>\n    window.addEventListener("DOMContentLoaded", () => {\n      new PagefindUI({ element: "#search", showSubResults: true });\n    });\n  </script>\n</body>|' "$file"
  fi
}

# Update main pages
for file in index.html; do
  if [[ -f "$file" ]]; then
    update_search "$file"
  fi
done

# Update commands pages
for file in commands/*.html; do
  if [[ -f "$file" ]]; then
    update_search "$file"
  fi
done

# Update docs pages
for file in docs/*.html; do
  if [[ -f "$file" ]]; then
    update_search "$file"
  fi
done

# Update examples pages
for file in examples/*.html; do
  if [[ -f "$file" ]]; then
    update_search "$file"
  fi
done

echo "✅ Search functionality updated in all pages"
echo "🎯 Pagefind UI is now integrated"
