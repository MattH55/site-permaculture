#!/bin/bash

FTP_HOST="ftp.prosperapolarplunge.com"
FTP_USER="DeLeeuw@makealbertagreatagain.live"
FTP_PASS="VUlovelovelove69"
FTP_DIR="/home/prossswh/makealbertagreatagain.live"

echo "Deploying to $FTP_HOST with FTPS..."
echo ""

# Upload public directory files
echo "Uploading public/ files..."
for file in public/*; do
  filename=$(basename "$file")
  echo "  → $filename"
  curl -k --ftp-ssl-control --ssl-reqd \
    -T "$file" \
    "ftps://$FTP_HOST$FTP_DIR/public/$filename" \
    --user "$FTP_USER:$FTP_PASS" \
    --silent --show-error
done

echo ""
echo "Uploading root files..."
for file in server.js package.json README.md SEO-CHECKLIST.md DEPLOYMENT-GUIDE.md; do
  if [ -f "$file" ]; then
    echo "  → $file"
    curl -k --ftp-ssl-control --ssl-reqd \
      -T "$file" \
      "ftps://$FTP_HOST$FTP_DIR/$file" \
      --user "$FTP_USER:$FTP_PASS" \
      --silent --show-error
  fi
done

echo ""
echo "✓ Upload complete!"
