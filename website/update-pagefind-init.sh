#!/bin/bash

echo "🔧 Updating Pagefind initialization..."

for file in index.html commands/*.html docs/*.html examples/*.html; do
  if [[ ! -f "$file" ]] || ! grep -q "pagefind-ui.js" "$file"; then
    continue
  fi
  
  echo "  📝 Processing $file..."
  
  # Remove broken initialization if exists
  sed -i '/if (typeof PagefindUI/,/setTimeout/d' "$file"
  sed -i '/new PagefindUI/d' "$file"
  sed -i '/}, 100);/d' "$file"
  
  # Add proper initialization before </body>
  if ! grep -q "initPagefind()" "$file"; then
    sed -i 's|</body>|  <script>\n    function initPagefind() {\n      if (document.getElementById("search") && typeof PagefindUI !== "undefined") {\n        new PagefindUI({ \n          element: "#search", \n          showSubResults: true,\n          highlightParam: "highlight"\n        });\n      }\n    }\n    \n    if (document.readyState === "loading") {\n      document.addEventListener("DOMContentLoaded", initPagefind);\n    } else {\n      initPagefind();\n    }\n  </script>\n</body>|' "$file"
  fi
done

echo "✅ Pagefind initialization updated"
