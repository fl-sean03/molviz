# MolViz Implementation Specification

## 1. System Overview

### 1.1 Goals
- Provide VMD-quality molecular visualization with modern UI
- Enable smooth 60fps interaction via WebGL preview
- Sync camera/view between fast preview and VMD renderer
- Support structure and view library management
- Enable agent (Claude) integration for programmatic control

### 1.2 Non-Goals (MVP)
- Trajectory playback (future)
- Molecular editing/building
- Analysis tools (RMSD, etc.)

---

## 2. Component Specifications

### 2.1 VMD Bridge (`src/backend/vmd_bridge.py`)

**Purpose**: Control headless VMD instance and capture frames.

**Dependencies**:
- vmd-python (conda: vmd-env)
- Xvfb (virtual framebuffer)
- Pillow (image handling)

**Interface**:
```python
class VMDBridge:
    async def start() -> None
        """Start headless VMD with Xvfb."""

    async def stop() -> None
        """Shutdown VMD and Xvfb."""

    async def load_structure(path: str) -> StructureInfo
        """Load PDB/PSF+DCD into VMD."""

    async def set_camera(matrix: CameraMatrix) -> None
        """Set VMD camera from matrix."""

    async def get_camera() -> CameraMatrix
        """Get current VMD camera matrix."""

    async def capture_frame(width: int, height: int) -> bytes
        """Render and capture current frame as PNG."""

    async def set_representation(rep: Representation) -> None
        """Set molecular representation (VDW, CPK, etc.)."""

    async def execute_tcl(command: str) -> str
        """Execute arbitrary Tcl command."""
```

**Implementation Details**:

1. **Xvfb Setup**:
   ```bash
   Xvfb :99 -screen 0 1920x1080x24 &
   export DISPLAY=:99
   ```

2. **VMD Startup**:
   - Use vmd-python in headless mode
   - Or spawn `vmd -dispdev text` and communicate via socket

3. **Frame Capture**:
   - Method A: `render TachyonInternal` (ray-traced, slower)
   - Method B: `render snapshot` (OpenGL, faster)
   - Method C: Capture Xvfb framebuffer directly (fastest)

4. **Camera Matrix Format**:
   ```python
   @dataclass
   class CameraMatrix:
       rotate: List[List[float]]   # 4x4 rotation
       center: List[List[float]]   # 4x4 translation
       scale: List[List[float]]    # 4x4 scale
       global_: List[List[float]]  # 4x4 combined
   ```

---

### 2.2 Frame Server (`src/backend/frame_server.py`)

**Purpose**: WebSocket server for real-time frame streaming and command handling.

**Dependencies**:
- websockets
- asyncio
- msgpack (binary serialization)

**Protocol**:

```
Client → Server (Commands):
{
  "type": "set_camera",
  "data": { "rotate": [...], "center": [...], "scale": [...] }
}

{
  "type": "load_structure",
  "data": { "path": "/path/to/file.pdb" }
}

{
  "type": "request_frame",
  "data": { "width": 800, "height": 600, "quality": "high" }
}

Server → Client (Responses):
{
  "type": "frame",
  "data": "<base64 PNG or binary>"
}

{
  "type": "camera_update",
  "data": { "rotate": [...], ... }
}

{
  "type": "structure_loaded",
  "data": { "atoms": 1500, "bounds": [...] }
}
```

**Frame Streaming Strategy**:
- Maintain render queue
- Debounce rapid camera updates (16ms minimum)
- Skip frames if client is slow
- Target 15-30fps for VMD frames

---

### 2.3 Frontend Application (`src/frontend/`)

**Structure**:
```
src/frontend/
├── main.ts              # Electron main process
├── preload.ts           # Preload script
├── renderer/
│   ├── index.html
│   ├── index.tsx        # React entry
│   ├── App.tsx          # Main app component
│   ├── components/
│   │   ├── FastViewport.tsx    # 3Dmol.js viewport
│   │   ├── VMDViewport.tsx     # VMD frame display
│   │   ├── Toolbar.tsx
│   │   ├── StructureLibrary.tsx
│   │   └── ViewLibrary.tsx
│   ├── hooks/
│   │   ├── useCamera.ts
│   │   ├── useVMDConnection.ts
│   │   └── useStructure.ts
│   └── styles/
└── package.json
```

**FastViewport Component**:
```typescript
interface FastViewportProps {
  structure: Structure | null;
  camera: CameraState;
  onCameraChange: (camera: CameraState) => void;
}

// Uses 3Dmol.js
// Handles mouse/touch for rotation, zoom, pan
// Emits camera changes on interaction
```

**VMDViewport Component**:
```typescript
interface VMDViewportProps {
  frameData: string | null;  // Base64 PNG
  loading: boolean;
}

// Simply displays the latest frame from VMD
// Shows loading indicator when VMD is rendering
```

**Camera Sync Hook**:
```typescript
function useCamera() {
  const [camera, setCamera] = useState<CameraState>(defaultCamera);

  // Debounced sync to VMD
  const syncToVMD = useDebouncedCallback((cam: CameraState) => {
    ws.send({ type: 'set_camera', data: cam });
  }, 16);  // ~60fps max

  const updateCamera = (newCamera: CameraState) => {
    setCamera(newCamera);      // Immediate local update
    syncToVMD(newCamera);      // Debounced VMD update
  };

  return { camera, updateCamera };
}
```

---

### 2.4 Camera Matrix Conversion

**Challenge**: 3Dmol.js and VMD use different camera representations.

**3Dmol.js Camera**:
```javascript
{
  position: { x, y, z },
  rotation: { x, y, z, w },  // Quaternion
  zoom: number
}
```

**VMD Camera**:
```tcl
molinfo top get rotate_matrix   # 4x4 matrix
molinfo top get center_matrix   # 4x4 matrix
molinfo top get scale_matrix    # 4x4 matrix
```

**Conversion Functions** (`src/shared/camera.ts`):
```typescript
function threeDmolToVMD(camera: ThreeDmolCamera): VMDCamera {
  // Convert quaternion to rotation matrix
  // Apply coordinate system transformation
  // VMD uses different axis conventions
}

function vmdToThreeDmol(camera: VMDCamera): ThreeDmolCamera {
  // Extract rotation from matrix
  // Convert to quaternion
  // Map zoom/scale
}
```

---

### 2.5 Data Layer (`src/backend/database.py`)

**Schema**:
```sql
-- Structures table
CREATE TABLE structures (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'pdb', 'psf+dcd', etc.
  atom_count INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSON
);

-- Views table
CREATE TABLE views (
  id INTEGER PRIMARY KEY,
  structure_id INTEGER REFERENCES structures(id),
  name TEXT NOT NULL,
  camera_matrix JSON NOT NULL,
  representation JSON,
  thumbnail BLOB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trajectories table (future)
CREATE TABLE trajectories (
  id INTEGER PRIMARY KEY,
  structure_id INTEGER REFERENCES structures(id),
  dcd_path TEXT,
  frame_count INTEGER,
  metadata JSON
);
```

---

## 3. Development Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Set up Electron app shell
- [ ] Implement VMD Bridge with frame capture
- [ ] Basic WebSocket frame streaming
- [ ] Single viewport displaying VMD frames

### Phase 2: Dual Viewport (Week 2)
- [ ] Integrate 3Dmol.js fast viewport
- [ ] Implement camera sync
- [ ] Side-by-side layout
- [ ] Basic toolbar (load structure)

### Phase 3: Library Features (Week 3)
- [ ] SQLite database integration
- [ ] Structure library panel
- [ ] View save/load
- [ ] Thumbnails

### Phase 4: Polish & Agent Integration (Week 4)
- [ ] UI refinement
- [ ] MCP server for Claude control
- [ ] Keyboard shortcuts
- [ ] Error handling

---

## 4. File Formats

### 4.1 View State File (`.molview`)
```json
{
  "version": "1.0",
  "structure": {
    "path": "/path/to/structure.pdb",
    "type": "pdb"
  },
  "camera": {
    "rotate_matrix": [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]],
    "center_matrix": [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]],
    "scale_matrix": [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]]
  },
  "representation": {
    "style": "VDW",
    "color_scheme": "element",
    "selections": [
      { "selection": "name Pt", "style": "VDW 0.8", "color": "gray" },
      { "selection": "name C*", "style": "CPK", "color": "black" }
    ]
  }
}
```

---

## 5. Testing Strategy

### Unit Tests
- Camera conversion functions
- VMD command generation
- Database operations

### Integration Tests
- VMD Bridge frame capture
- WebSocket communication
- Full render pipeline

### Manual Tests
- Load various structure types
- Camera sync smoothness
- Memory usage over time

---

## 6. Performance Targets

| Metric | Target |
|--------|--------|
| Fast viewport FPS | 60fps |
| VMD frame latency | <100ms |
| VMD streaming FPS | 15-30fps |
| Structure load time | <2s for 10k atoms |
| Memory usage | <500MB baseline |

---

## 7. Dependencies

### Backend (Python)
```
vmd-python        # VMD control (via conda)
websockets>=12.0  # WebSocket server
pillow>=10.0      # Image handling
aiosqlite>=0.19   # Async SQLite
msgpack>=1.0      # Binary serialization
```

### Frontend (Node.js)
```
electron>=28.0
react>=18.0
3dmol>=2.0
typescript>=5.0
```

### System
```
Xvfb              # Virtual framebuffer
tachyon           # Ray tracer (optional, for high quality)
```
