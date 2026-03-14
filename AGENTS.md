# MolViz - Molecular Visualization Platform

## Project Overview

A dual-viewport molecular visualization application that combines:
- **Fast WebGL preview** (60fps, smooth interaction)
- **VMD-quality rendering** (streamed from headless VMD)

Both viewports stay synced in real-time.

## Current Status

**Phase**: Initial Development
**Started**: 2026-03-13

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron App (UI Shell)                  │
├────────────────────────────┬────────────────────────────────┤
│   Fast Viewport (3Dmol.js) │   VMD Viewport (Streamed)      │
│   - 60fps WebGL            │   - Headless VMD render        │
│   - Mouse/touch input      │   - Frame capture via Xvfb     │
│   - Instant response       │   - 10-30fps high quality      │
├────────────────────────────┴────────────────────────────────┤
│                    Sync Controller                          │
│   - Camera matrix sync                                      │
│   - Bidirectional updates                                   │
│   - Debounced VMD commands                                  │
├─────────────────────────────────────────────────────────────┤
│                    Data Layer                               │
│   - Structure library (SQLite)                              │
│   - View library (saved camera states)                      │
│   - Trajectory cache                                        │
├─────────────────────────────────────────────────────────────┤
│                    VMD Bridge (Python)                      │
│   - Headless VMD control                                    │
│   - Frame capture pipeline                                  │
│   - Tcl command interface                                   │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

1. **VMD Bridge** (`src/backend/vmd_bridge.py`)
   - Manages headless VMD process
   - Sends Tcl commands
   - Captures rendered frames

2. **Frame Server** (`src/backend/frame_server.py`)
   - WebSocket server for frame streaming
   - Handles camera sync messages
   - Manages render queue

3. **Frontend App** (`src/frontend/`)
   - Electron shell
   - 3Dmol.js fast viewport
   - VMD frame display
   - UI controls

4. **Sync Controller** (`src/shared/sync.ts`)
   - Camera matrix conversion (3Dmol ↔ VMD)
   - Event debouncing
   - State management

## Tech Stack

- **Frontend**: Electron + TypeScript + 3Dmol.js
- **Backend**: Python + vmd-python + asyncio
- **IPC**: WebSocket (frame streaming) + JSON-RPC (commands)
- **Database**: SQLite (structures, views)
- **Virtual Display**: Xvfb (Linux)

## Development Commands

```bash
# Setup
cd /home/sf2/LabWork/Workspace/33-MolViz
./scripts/setup.sh

# Development
./scripts/dev.sh          # Start backend + frontend

# Testing
./scripts/test.sh
```

## Agent Instructions

When working on this project:
1. Backend code goes in `src/backend/`
2. Frontend code goes in `src/frontend/`
3. Shared types/utils go in `src/shared/`
4. Test with small PDB files first
5. VMD must be run in vmd-env conda environment
