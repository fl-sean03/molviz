#!/bin/bash
# MolViz Development Script
# Starts both backend (VMD frame server) and frontend (Vite dev server)

set -e

PROJECT_DIR="/home/sf2/LabWork/Workspace/33-MolViz"
cd "$PROJECT_DIR"

echo "=== MolViz Development Server ==="
echo ""

# Check if Xvfb is needed
if [ -z "$DISPLAY" ]; then
    echo "Starting Xvfb..."
    Xvfb :99 -screen 0 1920x1080x24 &
    XVFB_PID=$!
    export DISPLAY=:99
    sleep 1
fi

# Trap to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    if [ -n "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    if [ -n "$XVFB_PID" ]; then
        kill $XVFB_PID 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start backend
echo "[1] Starting VMD Frame Server..."
cd "$PROJECT_DIR/src/backend"
conda run -n vmd-env python frame_server.py &
BACKEND_PID=$!
sleep 2

# Start frontend
echo "[2] Starting Vite Dev Server..."
cd "$PROJECT_DIR/src/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "=== Servers Running ==="
echo "  Backend:  ws://localhost:8765"
echo "  Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop"

# Wait for either process to exit
wait
