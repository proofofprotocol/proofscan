#!/bin/bash
# Create a simple SVG favicon and convert to ICO

# Create SVG file
cat > favicon.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#3b82f6"/>
  <text x="50" y="70" font-family="Arial, sans-serif" font-size="60" font-weight="bold" fill="white" text-anchor="middle">P</text>
</svg>
EOF

# Use ImageMagick to convert SVG to ICO (if available)
if command -v convert &> /dev/null; then
  convert favicon.svg -define icon:auto-resize=16,32,48 favicon.ico
  echo "✅ favicon.ico created with ImageMagick"
else
  # Fallback: use the SVG directly as favicon
  cp favicon.svg favicon.ico
  echo "⚠️  ImageMagick not available, using SVG as fallback"
fi

ls -lh favicon.*
