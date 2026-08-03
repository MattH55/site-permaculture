# Deployment Guide — Expanding Edge Site to makealbertagreatagain.live

Your site is ready to deploy to your FTP server. Follow these instructions to upload the files.

## FTP Server Details

- **Host:** ftp.prosperapolarplunge.com
- **Username:** DeLeeuw@makealbertagreatagain.live
- **Password:** VUlovelovelove69
- **Port:** 21
- **Target Folder:** `/home/prossswh/makealbertagreatagain.live`

## Option 1: Using FileZilla (GUI - Easiest)

1. **Download FileZilla** from https://filezilla-project.org/
2. **Open FileZilla** and go to **File → Site Manager**
3. **New Site**, then fill in:
   - **Protocol:** FTP
   - **Host:** ftp.prosperapolarplunge.com
   - **Port:** 21
   - **Logon Type:** Normal
   - **User:** DeLeeuw@makealbertagreatagain.live
   - **Password:** VUlovelovelove69
4. **Connect**
5. **Navigate** on the remote side to `/home/prossswh/makealbertagreatagain.live`
6. **Upload the `public/` folder contents:**
   - index.html
   - about.html
   - contact.html
   - design.html
   - styles.css
   - robots.txt
   - sitemap.xml
7. **Upload root files** to `/home/prossswh/makealbertagreatagain.live`:
   - server.js
   - package.json
   - package-lock.json (if you generated one)
   - README.md

## Option 2: Using Command Line (Linux/Mac/PowerShell)

### Linux/Mac with `lftp`:
```bash
lftp -u DeLeeuw@makealbertagreatagain.live,VUlovelovelove69 ftp.prosperapolarplunge.com << EOF
cd /home/prossswh/makealbertagreatagain.live
mirror -R ./public ./public
mput server.js package.json README.md SEO-CHECKLIST.md DEPLOYMENT-GUIDE.md
quit
EOF
```

### Windows PowerShell:
```powershell
$source = "C:\path\to\website\folder"
$ftpHost = "ftp://ftp.prosperapolarplunge.com/home/prossswh/makealbertagreatagain.live"
$username = "DeLeeuw@makealbertagreatagain.live"
$password = "VUlovelovelove69"

# Use WinSCP or curl instead for better reliability
# See Option 3 below
```

## Option 3: Using WinSCP (Windows - Recommended)

1. **Download WinSCP** from https://winscp.net/
2. **Open WinSCP** → **New Session**
3. **Fill in:**
   - **File Protocol:** FTP
   - **Host name:** ftp.prosperapolarplunge.com
   - **Port number:** 21
   - **User name:** DeLeeuw@makealbertagreatagain.live
   - **Password:** VUlovelovelove69
4. **Login**
5. **On the right panel**, navigate to `/home/prossswh/makealbertagreatagain.live`
6. **Drag and drop** all files from `Expanding Edge Website/` folder to the remote folder:
   - Entire `public/` directory with all its files
   - server.js
   - package.json
   - All other root files

## Directory Structure on Server

After uploading, your server should have:

```
/home/prossswh/makealbertagreatagain.live/
├── public/
│   ├── index.html
│   ├── about.html
│   ├── contact.html
│   ├── design.html
│   ├── styles.css
│   ├── robots.txt
│   └── sitemap.xml
├── server.js
├── package.json
└── [other supporting files]
```

## Post-Upload Steps

### 1. Install Dependencies
SSH into your server and run:
```bash
cd /home/prossswh/makealbertagreatagain.live
npm install
```

### 2. Start the Server
```bash
npm start
# or use a process manager like PM2
npm install -g pm2
pm2 start server.js --name "expanding-edge"
pm2 save
pm2 startup
```

### 3. Test the Site
Visit: `https://makealbertagreatagain.live` and verify:
- [ ] Home page loads
- [ ] Navigation links work
- [ ] Contact form submits
- [ ] All pages have correct canonical URLs
- [ ] Styles load correctly

### 4. Configure Environment (Optional)

If you want to store contacts in a database instead of a file, create `.env`:
```bash
DATABASE_URL=postgresql://user:password@host/dbname
ADMIN_KEY=your_secret_key_for_csv_export
```

Otherwise, contacts are saved to `contacts.jsonl` automatically.

### 5. Set Up Email Notifications (Optional)

Edit `server.js` to uncomment and configure email sending:
```javascript
// Uncomment and configure with your email service
// await sendNotification(lead);
```

Consider using Resend, SendGrid, or similar service.

## Troubleshooting

### Site shows blank page
- Check that all `public/` files uploaded correctly
- Verify `server.js` is in the root directory
- Check server logs: `tail -f /var/log/node.log` or similar

### 404 errors on subpages
- Ensure `server.js` has the catch-all route: `app.get('*', (req, res) => res.sendFile(...))`
- Files should return HTML, not 404

### Styles not loading
- Check that `styles.css` is in `public/` folder
- Verify file permissions are readable

### Contact form not working
- Check that `/api/submit` endpoint is accessible
- Verify `contacts.jsonl` file has write permissions
- Check browser console for errors

## Security Recommendations

After deployment:

1. **Change FTP password** (the one you shared is now known in logs)
2. **Use SFTP instead of FTP** if possible (encrypted transfer)
3. **Set file permissions:** 
   ```bash
   chmod 644 public/*
   chmod 755 public
   chmod 755 .
   ```
4. **Create `.env.local`** for sensitive data (not in git)
5. **Monitor `/api/submit`** for spam submissions

## Support

If you encounter issues:
- Check server error logs
- Verify all files uploaded completely (no truncated files)
- Ensure Node.js is installed on the server
- Contact your hosting provider for FTP/SSH access issues

Contact: (780) 236-3630 | info@expandingedge.ca
