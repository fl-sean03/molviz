#!/bin/bash
# MolViz Setup Script

set -e

PROJECT_DIR="/home/sf2/LabWork/Workspace/33-MolViz"
cd "$PROJECT_DIR"

echo "=== MolViz Setup ==="

# 1. Check system dependencies
echo "[1/5] Checking system dependencies..."

if ! command -v Xvfb &> /dev/null; then
    echo "  Installing Xvfb..."
    sudo apt-get update && sudo apt-get install -y xvfb
else
    echo "  Xvfb: OK"
fi

if ! command -v tachyon &> /dev/null; then
    echo "  Warning: tachyon not found (optional, for high-quality renders)"
else
    echo "  Tachyon: OK"
fi

# 2. Setup Python backend environment
echo "[2/5] Setting up Python backend..."

if ! conda env list | grep -q "molviz"; then
    echo "  Creating molviz conda environment..."
    conda create -n molviz python=3.12 -y
fi

echo "  Installing Python dependencies..."
conda run -n molviz pip install websockets pillow aiosqlite msgpack numpy

# Check if vmd-python is available
if conda run -n molviz python -c "import vmd" 2>/dev/null; then
    echo "  vmd-python: OK"
else
    echo "  Installing vmd-python..."
    conda run -n molviz conda install -c conda-forge vmd-python -y
fi

# 3. Setup Node.js frontend
echo "[3/5] Setting up Node.js frontend..."

cd "$PROJECT_DIR/src/frontend"

if [ ! -f "package.json" ]; then
    echo "  Initializing npm project..."
    npm init -y
fi

echo "  Installing Node.js dependencies..."
npm install electron react react-dom 3dmol typescript @types/react @types/node
npm install -D electron-builder vite @vitejs/plugin-react

# 4. Create initial config files
echo "[4/5] Creating config files..."

cd "$PROJECT_DIR"

# Python requirements
cat > requirements.txt << 'EOF'
websockets>=12.0
pillow>=10.0
aiosqlite>=0.19
msgpack>=1.0
numpy>=1.24
EOF

# 5. Initialize database
echo "[5/5] Initializing database..."

mkdir -p "$PROJECT_DIR/data"

conda run -n molviz python << 'EOF'
import sqlite3
import os

db_path = "/home/sf2/LabWork/Workspace/33-MolViz/data/molviz.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.executescript("""
CREATE TABLE IF NOT EXISTS structures (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  atom_count INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSON
);

CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY,
  structure_id INTEGER REFERENCES structures(id),
  name TEXT NOT NULL,
  camera_matrix JSON NOT NULL,
  representation JSON,
  thumbnail BLOB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
""")

conn.commit()
conn.close()
print("  Database initialized: " + db_path)
EOF

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start development:"
echo "  cd $PROJECT_DIR"
echo "  ./scripts/dev.sh"
