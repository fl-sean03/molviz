#!/bin/bash
# MolViz VPS Setup Script for Hetzner (Ubuntu 22.04)
# Run as root or with sudo

set -e

echo "=== MolViz Backend VPS Setup ==="

# Update system
apt-get update && apt-get upgrade -y

# Install system dependencies
apt-get install -y \
    xvfb \
    wget \
    git \
    curl \
    build-essential \
    libgl1-mesa-glx \
    libxi6 \
    libxrender1 \
    libxrandr2 \
    libxcursor1 \
    libxinerama1 \
    libfontconfig1 \
    ufw

# Create molviz user
if ! id "molviz" &>/dev/null; then
    useradd -m -s /bin/bash molviz
    echo "Created user: molviz"
fi

# Switch to molviz user for the rest
su - molviz << 'MOLVIZ_USER'
set -e
cd ~

# Install Miniconda
if [ ! -d "$HOME/miniconda3" ]; then
    echo "Installing Miniconda..."
    wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O miniconda.sh
    bash miniconda.sh -b -p $HOME/miniconda3
    rm miniconda.sh

    # Initialize conda
    $HOME/miniconda3/bin/conda init bash
fi

# Source conda
source $HOME/miniconda3/etc/profile.d/conda.sh

# Create vmd-env
if ! conda env list | grep -q "vmd-env"; then
    echo "Creating vmd-env..."
    conda create -n vmd-env python=3.11 -y
fi

# Install dependencies in vmd-env
conda activate vmd-env
conda install -c conda-forge vmd-python -y
pip install websockets pillow aiosqlite msgpack numpy

# Clone or update MolViz
if [ ! -d "$HOME/molviz" ]; then
    git clone https://github.com/fl-sean03/molviz.git $HOME/molviz
else
    cd $HOME/molviz && git pull
fi

echo "MolViz user setup complete!"
MOLVIZ_USER

# Setup systemd service
cat > /etc/systemd/system/molviz-backend.service << 'EOF'
[Unit]
Description=MolViz VMD Backend Server
After=network.target

[Service]
Type=simple
User=molviz
WorkingDirectory=/home/molviz/molviz/src/backend
Environment="DISPLAY=:99"
ExecStartPre=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 &
ExecStart=/home/molviz/miniconda3/envs/vmd-env/bin/python frame_server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create Xvfb service
cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=X Virtual Frame Buffer
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start services
systemctl daemon-reload
systemctl enable xvfb
systemctl start xvfb
systemctl enable molviz-backend
systemctl start molviz-backend

# Configure firewall
ufw allow 22/tcp    # SSH
ufw allow 8765/tcp  # WebSocket
ufw --force enable

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Backend running on port 8765"
echo "Check status: systemctl status molviz-backend"
echo "View logs: journalctl -u molviz-backend -f"
echo ""
echo "Your WebSocket URL: ws://$(curl -s ifconfig.me):8765"
