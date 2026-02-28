#!/bin/bash

echo "🔧 Fixing Pagefind initialization across all pages..."

# Function to fix Pagefind initialization
fix_pagefind() {
  local file="$1"
  
  if [[ ! -f "$file" ]]; then
    return
  fi
  
  # Check if file has Pagefind
  if ! grep -q "pagefind-ui.js" "$file"; then
    return
  fi
  
  echo "  📝 Fixing $file..."
  
  # Replace DOMContentLoaded with immediate initialization or setTimeout
  sed -i 's|window.addEventListener("DOMContentLoaded", () => {|if (typeof PagefindUI !== "undefined") {|' "$file"
  sed -i 's|new PagefindUI({ element: "#search", showSubResults: true });|  new PagefindUI({ element: "#search", showSubResults: true });|' "$file"
  sed -i 's|    });|} else {\n      setTimeout(() => {\n        if (typeof PagefindUI !== "undefined") {\n          new PagefindUI({ element: "#search", showSubResults: true });\n        }\n      }, 100);\n    }|' "$file"
}

# Fix all pages
for file in index.html commands/*.html docs/*.html examples/*.html; do
  if [[ -f "$file" ]]; then
    fix_pagefind "$file"
  fi
done

echo "✅ Pagefind initialization fixed"
