#!/bin/bash
source ../deploy_config.sh

# Test CSS upload with full path
echo "Testing CSS upload..."
curl -v -T "css/docs.css" -u "$FTP_USER:$FTP_PASS" \
  "${FTP_HOST}${FTP_DIR}css/docs.css" \
  --ftp-create-dirs 2>&1 | grep -E "(STOR|226|250)"

# List uploaded files
echo ""
echo "Listing files..."
curl -u "$FTP_USER:$FTP_PASS" "${FTP_HOST}${FTP_DIR}css/" 2>&1 | head -10
