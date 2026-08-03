#!/bin/bash

# FTP Configuration
FTP_HOST="ftp.prosperapolarplunge.com"
FTP_USER="DeLeeuw@makealbertagreatagain.live"
FTP_PASS="VUlovelovelove69"
FTP_DIR="/home/prossswh/makealbertagreatagain.live"

echo "Deploying Expanding Edge site to $FTP_HOST..."

# Create FTP commands file
cat > ftp_commands.txt << 'FTPCMD'
cd /home/prossswh/makealbertagreatagain.live
mkdir -p public
cd public
lcd public
mput *
cd ..
lcd ..
mput *.js
mput *.json
mput package*.json
mput README.md
mput SEO-CHECKLIST.md
mput .gitignore
quit
FTPCMD

# Execute FTP
ftp -inv $FTP_HOST << FTPCMD
user $FTP_USER $FTP_PASS
$(cat ftp_commands.txt)
FTPCMD

echo "FTP deployment complete!"
rm -f ftp_commands.txt
