"""
Frame Server - WebSocket server for real-time frame streaming.

Handles:
- Camera sync messages from frontend
- Frame rendering requests
- Structure loading commands
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Set
from dataclasses import dataclass
import time

import websockets
from websockets.server import WebSocketServerProtocol

from vmd_bridge import VMDBridge, CameraMatrix, Representation

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


@dataclass
class RenderRequest:
    """Pending render request."""
    width: int
    height: int
    quality: str
    timestamp: float


class FrameServer:
    """
    WebSocket server for VMD frame streaming.

    Protocol:
        Client → Server:
            {"type": "set_camera", "data": {"rotate": [...], ...}}
            {"type": "load_structure", "data": {"path": "..."}}
            {"type": "request_frame", "data": {"width": 800, "height": 600}}
            {"type": "set_representation", "data": {"reps": [...]}}
            {"type": "rotate", "data": {"axis": "y", "degrees": 10}}
            {"type": "reset_view"}
            {"type": "get_camera"}

        Server → Client:
            {"type": "frame", "data": "<base64>", "timestamp": ...}
            {"type": "camera_update", "data": {...}}
            {"type": "structure_loaded", "data": {...}}
            {"type": "error", "message": "..."}
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.host = host
        self.port = port
        self.bridge: Optional[VMDBridge] = None
        self.clients: Set[WebSocketServerProtocol] = set()

        # VMD operation lock - VMD is not thread-safe, serialize all operations
        self._vmd_lock = asyncio.Lock()

        # Render queue management
        self._render_lock = asyncio.Lock()
        self._last_render_time = 0.0
        self._min_render_interval = 0.033  # ~30fps max
        self._pending_render: Optional[RenderRequest] = None

        # Camera sync debouncing
        self._camera_update_task: Optional[asyncio.Task] = None
        self._pending_camera: Optional[CameraMatrix] = None

    async def start(self) -> None:
        """Start the frame server."""
        # Initialize VMD bridge
        self.bridge = VMDBridge()
        await self.bridge.start()
        logger.info("VMD Bridge started")

        # Start WebSocket server
        async with websockets.serve(self._handle_client, self.host, self.port):
            logger.info(f"Frame server running on ws://{self.host}:{self.port}")
            await asyncio.Future()  # Run forever

    async def stop(self) -> None:
        """Stop the frame server."""
        if self.bridge:
            await self.bridge.stop()

    async def _handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """Handle a client connection."""
        self.clients.add(websocket)
        client_id = id(websocket)
        logger.info(f"Client {client_id} connected")

        try:
            async for message in websocket:
                await self._process_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            logger.info(f"Client {client_id} disconnected")

    async def _process_message(self, websocket: WebSocketServerProtocol,
                                message: str) -> None:
        """Process incoming message from client."""
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            payload = data.get("data", {})

            if msg_type == "set_camera":
                await self._handle_set_camera(websocket, payload)

            elif msg_type == "load_structure":
                await self._handle_load_structure(websocket, payload)

            elif msg_type == "request_frame":
                await self._handle_request_frame(websocket, payload)

            elif msg_type == "set_representation":
                await self._handle_set_representation(websocket, payload)

            elif msg_type == "rotate":
                await self._handle_rotate(websocket, payload)

            elif msg_type == "reset_view":
                await self._handle_reset_view(websocket)

            elif msg_type == "get_camera":
                await self._handle_get_camera(websocket)

            elif msg_type == "execute_tcl":
                await self._handle_execute_tcl(websocket, payload)

            else:
                await self._send_error(websocket, f"Unknown message type: {msg_type}")

        except json.JSONDecodeError:
            await self._send_error(websocket, "Invalid JSON")
        except Exception as e:
            logger.exception("Error processing message")
            await self._send_error(websocket, str(e))

    async def _handle_set_camera(self, websocket: WebSocketServerProtocol,
                                  payload: Dict[str, Any]) -> None:
        """Handle camera update with debouncing."""
        logger.debug(f"Received camera update: zoom={payload.get('scale', [[1]])[0][0]:.3f}")
        camera = CameraMatrix.from_dict(payload)
        self._pending_camera = camera

        # Debounce camera updates
        if self._camera_update_task is None or self._camera_update_task.done():
            self._camera_update_task = asyncio.create_task(
                self._apply_camera_update()
            )

    async def _apply_camera_update(self) -> None:
        """Apply pending camera update after debounce delay."""
        await asyncio.sleep(0.016)  # ~60fps debounce

        if self._pending_camera and self.bridge:
            logger.info("Applying camera update and rendering")
            async with self._vmd_lock:
                await self.bridge.set_camera(self._pending_camera)
                self._pending_camera = None

                # Auto-render after camera change
                await self._render_and_broadcast_locked()
            logger.info("Camera update complete")

    async def _handle_load_structure(self, websocket: WebSocketServerProtocol,
                                      payload: Dict[str, Any]) -> None:
        """Handle structure loading."""
        path = payload.get("path")
        if not path:
            await self._send_error(websocket, "No path provided")
            return

        try:
            async with self._vmd_lock:
                info = await self.bridge.load_structure(path)

                # Read PDB content for WebGL preview
                pdb_content = ""
                try:
                    with open(path, 'r') as f:
                        pdb_content = f.read()
                except Exception as e:
                    logger.warning(f"Could not read PDB content: {e}")

                await self._send(websocket, {
                    "type": "structure_loaded",
                    "data": {
                        "mol_id": info.mol_id,
                        "path": info.path,
                        "atom_count": info.atom_count,
                        "residue_count": info.residue_count,
                        "bounds": info.bounds,
                        "pdb_content": pdb_content
                    }
                })

                # Send initial frame (already have lock)
                await self._render_and_send_locked(websocket)

        except FileNotFoundError as e:
            await self._send_error(websocket, str(e))

    async def _handle_request_frame(self, websocket: WebSocketServerProtocol,
                                     payload: Dict[str, Any]) -> None:
        """Handle frame request."""
        width = payload.get("width", 800)
        height = payload.get("height", 600)
        quality = payload.get("quality", "fast")

        async with self._vmd_lock:
            await self._render_and_send_locked(websocket, width, height, quality)

    async def _handle_set_representation(self, websocket: WebSocketServerProtocol,
                                          payload: Dict[str, Any]) -> None:
        """Handle representation change."""
        reps_data = payload.get("reps", [])
        reps = [
            Representation(
                selection=r.get("selection", "all"),
                style=r.get("style", "CPK"),
                color=r.get("color", "Element"),
                material=r.get("material", "AOShiny")
            )
            for r in reps_data
        ]

        async with self._vmd_lock:
            await self.bridge.set_representation(reps)
            await self._render_and_send_locked(websocket)

    async def _handle_rotate(self, websocket: WebSocketServerProtocol,
                              payload: Dict[str, Any]) -> None:
        """Handle rotation command."""
        axis = payload.get("axis", "y")
        degrees = payload.get("degrees", 10)

        async with self._vmd_lock:
            await self.bridge.rotate(axis, degrees)
            await self._render_and_broadcast_locked()

    async def _handle_reset_view(self, websocket: WebSocketServerProtocol) -> None:
        """Handle view reset."""
        async with self._vmd_lock:
            await self.bridge.reset_view()
            await self._render_and_broadcast_locked()

    async def _handle_get_camera(self, websocket: WebSocketServerProtocol) -> None:
        """Handle camera query."""
        async with self._vmd_lock:
            camera = await self.bridge.get_camera()
        await self._send(websocket, {
            "type": "camera_update",
            "data": camera.to_dict()
        })

    async def _handle_execute_tcl(self, websocket: WebSocketServerProtocol,
                                   payload: Dict[str, Any]) -> None:
        """Handle arbitrary Tcl command."""
        command = payload.get("command", "")
        async with self._vmd_lock:
            result = await self.bridge.execute_tcl(command)
        await self._send(websocket, {
            "type": "tcl_result",
            "data": {"command": command, "result": result}
        })

    async def _render_and_send_locked(self, websocket: WebSocketServerProtocol,
                                        width: int = 800, height: int = 600,
                                        quality: str = "fast") -> None:
        """Render frame and send to specific client. Must be called with _vmd_lock held."""
        # Rate limiting
        now = time.time()
        if now - self._last_render_time < self._min_render_interval:
            await asyncio.sleep(self._min_render_interval)

        try:
            frame_b64 = await self.bridge.capture_frame_base64(width, height, quality)
            self._last_render_time = time.time()

            await self._send(websocket, {
                "type": "frame",
                "data": frame_b64,
                "timestamp": self._last_render_time,
                "width": width,
                "height": height
            })
        except Exception as e:
            await self._send_error(websocket, f"Render failed: {e}")

    async def _render_and_broadcast_locked(self, width: int = 800, height: int = 600) -> None:
        """Render frame and broadcast to all clients. Must be called with _vmd_lock held."""
        now = time.time()
        if now - self._last_render_time < self._min_render_interval:
            return  # Skip frame

        try:
            frame_b64 = await self.bridge.capture_frame_base64(width, height)
            self._last_render_time = time.time()

            message = {
                "type": "frame",
                "data": frame_b64,
                "timestamp": self._last_render_time
            }

            await self._broadcast(message)
        except Exception as e:
            logger.error(f"Broadcast render failed: {e}")

    async def _send(self, websocket: WebSocketServerProtocol,
                    message: Dict[str, Any]) -> None:
        """Send message to client."""
        try:
            await websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosed:
            pass

    async def _send_error(self, websocket: WebSocketServerProtocol,
                          error: str) -> None:
        """Send error message to client."""
        await self._send(websocket, {"type": "error", "message": error})

    async def _broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast message to all connected clients."""
        if not self.clients:
            return

        msg_str = json.dumps(message)
        await asyncio.gather(
            *[client.send(msg_str) for client in self.clients],
            return_exceptions=True
        )


async def main():
    """Run the frame server."""
    server = FrameServer()
    try:
        await server.start()
    except KeyboardInterrupt:
        await server.stop()


if __name__ == "__main__":
    asyncio.run(main())
