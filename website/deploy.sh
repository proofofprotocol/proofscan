#!/bin/bash
set -e

echo "🚀 ProofScan Website Deployment"
echo "================================"
echo ""

# Check if FTP credentials exist
if [ ! -f "../deploy_config.sh" ]; then
  echo "⚠️  FTP credentials not found"
  echo "Please set FTP_USER and FTP_PASS environment variables"
  echo ""
  echo "Example:"
  echo "  export FTP_USER='pop@proofofprotocol.online'"
  echo "  export FTP_PASS='your-password'"
  exit 1
fi

source ../deploy_config.sh

echo "📊 Deployment Info:"
echo "   Host: $FTP_HOST"
echo "   User: $FTP_USER"
echo "   Directory: $FTP_DIR"
echo ""

# Upload index.html
echo "📤 Uploading index.html..."
curl -T "index.html" -u "$FTP_USER:$FTP_PASS" "$FTP_HOST$FTP_DIR" --ftp-create-dirs

# Upload CSS
echo "📤 Uploading CSS files..."
for file in css/*.css; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "  → $filename"
    curl -T "$file" -u "$FTP_USER:$FTP_PASS" "$FTP_HOST${FTP_DIR}css/$filename" --ftp-create-dirs
  fi
done

# Upload JS
echo "📤 Uploading JS files..."
for file in js/*.js; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "  → $filename"
    curl -T "$file" -u "$FTP_USER:$FTP_PASS" "$FTP_HOST${FTP_DIR}js/$filename" --ftp-create-dirs
  fi
done

# Upload commands
echo "📤 Uploading commands pages..."
for file in commands/*.html; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "  → $filename"
    curl -T "$file" -u "$FTP_USER:$FTP_PASS" "$FTP_HOST${FTP_DIR}commands/$filename" --ftp-create-dirs
  fi
done

# Upload examples
echo "📤 Uploading examples pages..."
for file in examples/*.html; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "  → $filename"
    curl -T "$file" -u "$FTP_USER:$FTP_PASS" "$FTP_HOST${FTP_DIR}examples/$filename" --ftp-create-dirs
  fi
done

echo ""
echo "✅ Deployment completed!"
echo "🌐 Your site is now live at: https://proofofprotocol.online/"
echo ""
echo "🔍 Next steps:"
echo "  1. Visit https://proofofprotocol.online/ to verify"
echo "  2. Check all pages are loading correctly"
echo "  3. Test navigation and search"
echo "  4. Verify mobile responsiveness"
