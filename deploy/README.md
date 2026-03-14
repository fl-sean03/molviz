# MolViz Backend Deployment

Deploy the VMD rendering backend to a Hetzner VPS.

## Requirements

- Hetzner Cloud VPS (CX22 or higher recommended)
- Ubuntu 22.04 LTS
- ~4GB RAM minimum

## Quick Deploy

### 1. Create VPS

Create a Hetzner Cloud server:
- **Type**: CX22 (2 vCPU, 4GB RAM) - ~€4/month
- **Image**: Ubuntu 22.04
- **Location**: Your preferred region
- **SSH Key**: Add your public key

### 2. Run Setup Script

SSH into your server and run:

```bash
# Download and run setup script
curl -fsSL https://raw.githubusercontent.com/fl-sean03/molviz/main/deploy/setup-vps.sh | sudo bash
```

Or manually:

```bash
git clone https://github.com/fl-sean03/molviz.git
cd molviz/deploy
sudo bash setup-vps.sh
```

### 3. Get Your Backend URL

After setup completes, you'll see:
```
Your WebSocket URL: ws://YOUR_IP:8765
```

### 4. Configure Frontend

Visit https://molviz.vercel.app and:
1. Click the ⚙️ Settings button (or click "Disconnected" in status bar)
2. Enter your backend URL: `ws://YOUR_IP:8765`
3. Click "Save & Reconnect"

## Managing the Service

```bash
# Check status
sudo systemctl status molviz-backend

# View logs
sudo journalctl -u molviz-backend -f

# Restart service
sudo systemctl restart molviz-backend

# Stop service
sudo systemctl stop molviz-backend
```

## Updating

```bash
# SSH into server
ssh root@YOUR_IP

# Update code
su - molviz
cd ~/molviz
git pull

# Restart service
exit
sudo systemctl restart molviz-backend
```

## Security Notes

- Port 8765 is open for WebSocket connections
- Consider adding HTTPS/WSS with a reverse proxy (nginx + Let's Encrypt)
- For production, restrict CORS origins

## Adding SSL (Optional)

For secure WebSocket (wss://):

```bash
# Install nginx and certbot
apt install nginx certbot python3-certbot-nginx -y

# Configure nginx as reverse proxy
cat > /etc/nginx/sites-available/molviz << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
EOF

ln -s /etc/nginx/sites-available/molviz /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL certificate
certbot --nginx -d YOUR_DOMAIN
```

Then use `wss://YOUR_DOMAIN` as your backend URL.
