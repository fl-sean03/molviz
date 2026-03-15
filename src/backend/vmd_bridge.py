"""
VMD Bridge - Control headless VMD and capture frames.

This module provides a Python interface to control VMD running in headless mode,
send Tcl commands, and capture rendered frames.

IMPORTANT: All VMD operations must run in a dedicated thread to avoid SEGV crashes.
VMD's C extensions are not safe to call from asyncio coroutines.
"""

import asyncio
import subprocess
import os
import tempfile
import json
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Any
import base64
import threading
from concurrent.futures import ThreadPoolExecutor

# Will be imported when running in vmd-env
try:
    import vmd
    from vmd import molecule, molrep, display, evaltcl
    VMD_AVAILABLE = True
except ImportError:
    VMD_AVAILABLE = False

# Single thread executor for all VMD operations - VMD is not thread-safe
_vmd_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vmd")


@dataclass
class CameraMatrix:
    """VMD camera state represented as 4x4 matrices."""
    rotate: List[List[float]]
    center: List[List[float]]
    scale: List[List[float]]
    global_: List[List[float]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            'rotate': self.rotate,
            'center': self.center,
            'scale': self.scale,
            'global': self.global_
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CameraMatrix':
        return cls(
            rotate=data['rotate'],
            center=data['center'],
            scale=data['scale'],
            global_=data.get('global', data.get('global_'))
        )

    @classmethod
    def identity(cls) -> 'CameraMatrix':
        """Return identity matrices (default view)."""
        ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        return cls(rotate=ident, center=ident, scale=ident, global_=ident)


@dataclass
class StructureInfo:
    """Information about a loaded structure."""
    mol_id: int
    path: str
    atom_count: int
    residue_count: int
    bounds: List[float]  # [min_x, min_y, min_z, max_x, max_y, max_z]


@dataclass
class Representation:
    """Molecular representation settings."""
    selection: str
    style: str  # VDW, CPK, Licorice, etc.
    color: str  # ColorID or color method
    material: str = "AOShiny"


class VMDBridge:
    """
    Bridge to control headless VMD instance.

    Usage:
        bridge = VMDBridge()
        await bridge.start()
        info = await bridge.load_structure("/path/to/file.pdb")
        frame = await bridge.capture_frame(800, 600)
        await bridge.stop()
    """

    def __init__(self, display_num: int = 99):
        self.display_num = display_num
        self.xvfb_process: Optional[subprocess.Popen] = None
        self.current_mol_id: Optional[int] = None
        self.temp_dir = Path(tempfile.mkdtemp(prefix="molviz_"))
        self._started = False
        self._vmd_thread_id: Optional[int] = None

    def _run_in_vmd_thread(self, func, *args, **kwargs):
        """Run a function in the VMD thread synchronously."""
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(_vmd_executor, lambda: func(*args, **kwargs))

    def _init_vmd_sync(self) -> None:
        """Initialize VMD - must run in VMD thread."""
        self._vmd_thread_id = threading.current_thread().ident
        evaltcl("display projection Orthographic")
        evaltcl("display depthcue off")
        evaltcl("color Display Background white")
        evaltcl("axes location Off")
        evaltcl("display shadows on")
        evaltcl("display ambientocclusion on")

    async def start(self) -> None:
        """Start Xvfb and initialize VMD."""
        if self._started:
            return

        # Check if DISPLAY is already set (e.g., by systemd service)
        if 'DISPLAY' not in os.environ:
            # Start Xvfb only if not already running
            xvfb_cmd = [
                "Xvfb",
                f":{self.display_num}",
                "-screen", "0", "1920x1080x24"
            ]

            self.xvfb_process = subprocess.Popen(
                xvfb_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )

            # Set display environment
            os.environ['DISPLAY'] = f":{self.display_num}"

            # Wait for Xvfb to start
            await asyncio.sleep(0.5)

        if not VMD_AVAILABLE:
            raise RuntimeError("vmd-python not available. Run in molviz conda environment.")

        # Initialize VMD in dedicated thread
        await self._run_in_vmd_thread(self._init_vmd_sync)

        self._started = True

    async def stop(self) -> None:
        """Shutdown VMD and Xvfb."""
        if self.xvfb_process:
            self.xvfb_process.terminate()
            self.xvfb_process.wait()
            self.xvfb_process = None

        # Cleanup temp directory
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

        self._started = False

    def _load_structure_sync(self, path_str: str, file_type: str) -> tuple:
        """Load structure in VMD thread - returns (mol_id, atom_count, residue_count, minmax_str)."""
        # Clear existing molecules
        for i in range(molecule.num()):
            molecule.delete(molecule.listall()[0])

        # Load new molecule
        mol_id = molecule.load(file_type, path_str)
        molecule.set_top(mol_id)

        # Get structure info
        atom_count = molecule.numatoms(mol_id)
        try:
            residue_count = int(evaltcl(f"llength [lsort -unique [[atomselect {mol_id} all] get resid]]"))
        except:
            residue_count = 1

        # Get bounding box
        evaltcl("set sel [atomselect top all]")
        minmax = evaltcl("measure minmax $sel")
        evaltcl("$sel delete")

        # Setup default representation
        self._setup_default_representation_sync(mol_id)

        # Reset view
        evaltcl("display resetview")

        return mol_id, atom_count, residue_count, minmax

    async def load_structure(self, path: str) -> StructureInfo:
        """Load a molecular structure into VMD."""
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(f"Structure file not found: {path}")

        # Determine file type
        suffix = path.suffix.lower()
        file_type = {
            '.pdb': 'pdb',
            '.psf': 'psf',
            '.dcd': 'dcd',
            '.xyz': 'xyz',
            '.mol2': 'mol2',
        }.get(suffix, 'pdb')

        # Run VMD operations in dedicated thread
        mol_id, atom_count, residue_count, minmax = await self._run_in_vmd_thread(
            self._load_structure_sync, str(path), file_type
        )

        self.current_mol_id = mol_id

        # Parse minmax result: {{x1 y1 z1} {x2 y2 z2}}
        bounds = self._parse_minmax(minmax)

        return StructureInfo(
            mol_id=mol_id,
            path=str(path),
            atom_count=atom_count,
            residue_count=residue_count,
            bounds=bounds
        )

    def _setup_default_representation_sync(self, mol_id: int) -> None:
        """Setup default molecular representation using Tcl commands. Must run in VMD thread."""
        # Delete default rep
        while molrep.num(mol_id) > 0:
            molrep.delrep(mol_id, 0)

        # Check what atoms we have
        has_pt = int(evaltcl('llength [[atomselect top {name "PT.*"}] list]')) > 0
        has_c = int(evaltcl('llength [[atomselect top {name "C.*"}] list]')) > 0

        if has_pt:
            # Pt nanoparticle system - use Tcl for proper color handling
            evaltcl('mol representation VDW 0.8 20')
            evaltcl('mol color ColorID 2')  # Gray
            evaltcl('mol selection {name "PT.*"}')
            evaltcl('mol material AOShiny')
            evaltcl('mol addrep top')

            if has_c:
                # Carbon - black CPK
                evaltcl('mol representation CPK 1.0 0.3 20 20')
                evaltcl('mol color ColorID 16')
                evaltcl('mol selection {name "C.*"}')
                evaltcl('mol addrep top')

                # Nitrogen - blue VDW
                evaltcl('mol representation VDW 0.6 20')
                evaltcl('mol color ColorID 0')
                evaltcl('mol selection {name "N.*"}')
                evaltcl('mol addrep top')

                # Hydrogen - white CPK
                evaltcl('mol representation CPK 0.5 0.2 20 20')
                evaltcl('mol color ColorID 8')
                evaltcl('mol selection {name "H.*"}')
                evaltcl('mol addrep top')

                # Bonds - black licorice
                evaltcl('mol representation Licorice 0.15 20 20')
                evaltcl('mol color ColorID 16')
                evaltcl('mol selection {not name "PT.*"}')
                evaltcl('mol addrep top')
        else:
            # Generic molecule - element coloring
            evaltcl('mol representation CPK 1.0 0.3 20 20')
            evaltcl('mol color Element')
            evaltcl('mol selection {all}')
            evaltcl('mol material AOShiny')
            evaltcl('mol addrep top')

    async def _setup_default_representation(self, mol_id: int) -> None:
        """Setup default molecular representation - async wrapper."""
        await self._run_in_vmd_thread(self._setup_default_representation_sync, mol_id)

    def _parse_minmax(self, minmax_str: str) -> List[float]:
        """Parse VMD minmax output."""
        try:
            # Format: {{x1 y1 z1} {x2 y2 z2}}
            import re
            numbers = re.findall(r'-?\d+\.?\d*', minmax_str)
            return [float(n) for n in numbers[:6]]
        except:
            return [0, 0, 0, 10, 10, 10]

    def _set_camera_sync(self, camera: CameraMatrix) -> None:
        """Set VMD camera - must run in VMD thread."""
        def matrix_to_tcl(m: List[List[float]]) -> str:
            """Convert 4x4 matrix to VMD Tcl list format.

            VMD expects: { { row1 } { row2 } { row3 } { row4 } }
            Note the extra outer braces wrapping the whole matrix.
            """
            rows = []
            for row in m:
                row_str = " ".join(f"{v:.6f}" for v in row)
                rows.append(f"{{ {row_str} }}")
            # Extra outer braces required by VMD
            return "{ { " + " ".join(rows) + " } }"

        try:
            evaltcl(f"molinfo top set rotate_matrix {matrix_to_tcl(camera.rotate)}")
            evaltcl(f"molinfo top set center_matrix {matrix_to_tcl(camera.center)}")
            evaltcl(f"molinfo top set scale_matrix {matrix_to_tcl(camera.scale)}")
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Failed to set camera: {e}")

    async def set_camera(self, camera: CameraMatrix) -> None:
        """Set VMD camera from matrix."""
        if self.current_mol_id is None:
            return
        await self._run_in_vmd_thread(self._set_camera_sync, camera)

    def _get_camera_sync(self) -> CameraMatrix:
        """Get current VMD camera matrix - must run in VMD thread."""
        def parse_matrix(tcl_result: str) -> List[List[float]]:
            """Parse Tcl matrix format to Python list."""
            import re
            # Remove outer braces and split
            numbers = re.findall(r'-?\d+\.?\d*e?-?\d*', tcl_result)
            floats = [float(n) for n in numbers]
            # Reshape to 4x4
            return [floats[i:i+4] for i in range(0, 16, 4)]

        rotate = parse_matrix(evaltcl("molinfo top get rotate_matrix"))
        center = parse_matrix(evaltcl("molinfo top get center_matrix"))
        scale = parse_matrix(evaltcl("molinfo top get scale_matrix"))
        global_ = parse_matrix(evaltcl("molinfo top get global_matrix"))

        return CameraMatrix(
            rotate=rotate,
            center=center,
            scale=scale,
            global_=global_
        )

    async def get_camera(self) -> CameraMatrix:
        """Get current VMD camera matrix."""
        if self.current_mol_id is None:
            return CameraMatrix.identity()
        return await self._run_in_vmd_thread(self._get_camera_sync)

    def _capture_frame_sync(self, width: int, height: int, quality: str) -> bytes:
        """Capture frame - must run in VMD thread."""
        from PIL import Image

        output_path = self.temp_dir / "frame.png"
        scene_path = self.temp_dir / "scene.dat"
        tga_path = self.temp_dir / "frame.tga"

        # Generate Tachyon scene file
        evaltcl(f'render Tachyon "{scene_path}"')

        # Adjust resolution for quality
        # Render at target resolution to avoid blur from upscaling
        if quality == "fast":
            render_width, render_height = width, height  # Full resolution
        elif quality == "medium":
            render_width, render_height = width, height
        else:
            render_width, render_height = width, height

        # Run tachyon renderer
        tachyon_args = ["tachyon", str(scene_path),
                        "-res", str(render_width), str(render_height),
                        "-format", "TGA", "-o", str(tga_path)]

        # Add antialiasing for better quality (1 sample is fast but helps edges)
        if quality == "fast":
            tachyon_args.extend(["-aasamples", "1"])
        elif quality == "medium":
            tachyon_args.extend(["-aasamples", "2"])
        else:
            tachyon_args.extend(["-aasamples", "4"])

        result = subprocess.run(tachyon_args, capture_output=True, text=True)

        # Convert TGA to PNG (and upscale if needed)
        if tga_path.exists():
            img = Image.open(tga_path)
            # Upscale to target size for display
            if img.width != width or img.height != height:
                img = img.resize((width, height), Image.Resampling.BILINEAR)
            img.save(output_path, "PNG", optimize=False)
            tga_path.unlink()
            if scene_path.exists():
                scene_path.unlink()

            with open(output_path, 'rb') as f:
                return f.read()

        # If tachyon failed, raise error with details
        raise RuntimeError(f"Tachyon render failed: {result.stderr}")

    async def capture_frame(self, width: int = 800, height: int = 600,
                            quality: str = "fast") -> bytes:
        """
        Render and capture current frame.

        Args:
            width: Image width
            height: Image height
            quality: "fast" (low-res tachyon), "medium" (half-res), "high" (full res)

        Returns:
            PNG image as bytes
        """
        if self.current_mol_id is None:
            raise RuntimeError("No structure loaded")

        return await self._run_in_vmd_thread(self._capture_frame_sync, width, height, quality)

    async def capture_frame_base64(self, width: int = 800, height: int = 600,
                                    quality: str = "fast") -> str:
        """Capture frame and return as base64 string."""
        frame_bytes = await self.capture_frame(width, height, quality)
        return base64.b64encode(frame_bytes).decode('utf-8')

    def _set_representation_sync(self, mol_id: int, reps: List[Representation]) -> None:
        """Set molecular representations - must run in VMD thread."""
        # Clear existing reps
        while molrep.num(mol_id) > 0:
            molrep.delrep(mol_id, 0)

        # Add new reps
        for rep in reps:
            molrep.addrep(
                mol_id,
                style=rep.style,
                color=rep.color,
                selection=rep.selection,
                material=rep.material
            )

    async def set_representation(self, reps: List[Representation]) -> None:
        """Set molecular representations."""
        if self.current_mol_id is None:
            return
        await self._run_in_vmd_thread(self._set_representation_sync, self.current_mol_id, reps)

    async def execute_tcl(self, command: str) -> str:
        """Execute arbitrary Tcl command and return result."""
        return await self._run_in_vmd_thread(evaltcl, command)

    async def rotate(self, axis: str, degrees: float) -> None:
        """Rotate view around axis."""
        await self._run_in_vmd_thread(evaltcl, f"rotate {axis} by {degrees}")

    async def scale(self, factor: float) -> None:
        """Scale/zoom view."""
        await self._run_in_vmd_thread(evaltcl, f"scale by {factor}")

    async def reset_view(self) -> None:
        """Reset to default view."""
        await self._run_in_vmd_thread(evaltcl, "display resetview")


# Convenience function for standalone testing
async def test_bridge():
    """Test the VMD bridge."""
    bridge = VMDBridge()
    await bridge.start()

    # Load a test structure
    test_pdb = "/home/sf2/LabWork/Workspace/31-Hydrogenation/presentations/2026-03-13-comprehensive-update/figures/vmd_configs/final/01_flat_6deg.pdb"

    if Path(test_pdb).exists():
        info = await bridge.load_structure(test_pdb)
        print(f"Loaded: {info.atom_count} atoms")

        # Capture a frame
        frame = await bridge.capture_frame(800, 600)
        print(f"Captured frame: {len(frame)} bytes")

        # Save test image
        with open("/tmp/molviz_test.png", 'wb') as f:
            f.write(frame)
        print("Saved: /tmp/molviz_test.png")

        # Get camera
        camera = await bridge.get_camera()
        print(f"Camera: {camera.scale}")

    await bridge.stop()


if __name__ == "__main__":
    asyncio.run(test_bridge())
