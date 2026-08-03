#!/bin/bash

FTP_HOST="ftp.prosperapolarplunge.com"
FTP_USER="DeLeeuw@makealbertagreatagain.live"
FTP_PASS="VUlovelovelove69"
FTP_DIR="/home/prossswh/makealbertagreatagain.live"
FTP_URL="ftp://$FTP_USER:$FTP_PASS@$FTP_HOST"

echo "Deploying Expanding Edge site to $FTP_HOST..."
echo ""

# Upload public directory files
echo "Uploading public/ files..."
for file in public/*; do
  filename=$(basename "$file")
  echo "  Uploading $filename..."
  curl -T "$file" "$FTP_URL$FTP_DIR/public/$filename" 2>/dev/null && echo "    ✓ $filename" || echo "    ✗ $filename failed"
done

echo ""
echo "Uploading root files..."
# Upload root files
for file in server.js package.json package-lock.json README.md SEO-CHECKLIST.md DEPLOYMENT-GUIDE.md .gitignore; do
  if [ -f "$file" ]; then
    echo "  Uploading $file..."
    curl -T "$file" "$FTP_URL$FTP_DIR/$file" 2>/dev/null && echo "    ✓ $file" || echo "    ✗ $file failed"
  fi
done

echo ""
echo "✓ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. SSH into your server"
echo "  2. cd $FTP_DIR"
echo "  3. npm install"
echo "  4. npm start (or use PM2)"
echo "  5. Visit https://makealbertagreatagain.live"
