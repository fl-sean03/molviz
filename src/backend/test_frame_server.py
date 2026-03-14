"""
Headless test for Frame Server WebSocket connectivity.
Tests full message protocol without needing a browser.
"""

import asyncio
import json
import base64
from pathlib import Path

# Test WebSocket client
import websockets


async def test_frame_server():
    """Test frame server with simulated client."""
    test_pdb = "/home/sf2/LabWork/Workspace/31-Hydrogenation/presentations/2026-03-13-comprehensive-update/figures/vmd_configs/final/01_flat_6deg.pdb"
    output_dir = Path("/tmp/molviz_server_test")
    output_dir.mkdir(exist_ok=True)

    print("=== Frame Server Test ===")
    print(f"Test PDB: {test_pdb}")
    print(f"Output: {output_dir}")
    print()

    try:
        async with websockets.connect("ws://localhost:8765") as ws:
            print("[1] Connected to ws://localhost:8765")

            # Test 1: Load structure
            print("[2] Loading structure...")
            await ws.send(json.dumps({
                "type": "load_structure",
                "data": {"path": test_pdb}
            }))

            # Wait for structure_loaded and initial frame
            for _ in range(2):
                response = await asyncio.wait_for(ws.recv(), timeout=30)
                data = json.loads(response)
                msg_type = data.get("type")

                if msg_type == "structure_loaded":
                    info = data.get("data", {})
                    print(f"    Loaded: {info.get('atom_count')} atoms")
                elif msg_type == "frame":
                    frame_b64 = data.get("data")
                    frame_bytes = base64.b64decode(frame_b64)
                    frame_path = output_dir / "test_01_initial.png"
                    with open(frame_path, 'wb') as f:
                        f.write(frame_bytes)
                    print(f"    Initial frame: {len(frame_bytes)} bytes → {frame_path}")
                elif msg_type == "error":
                    print(f"    ERROR: {data.get('message')}")
                    return False

            # Test 2: Request specific frame size
            print("[3] Requesting 1024x768 frame...")
            await ws.send(json.dumps({
                "type": "request_frame",
                "data": {"width": 1024, "height": 768, "quality": "fast"}
            }))

            response = await asyncio.wait_for(ws.recv(), timeout=30)
            data = json.loads(response)
            if data.get("type") == "frame":
                frame_bytes = base64.b64decode(data.get("data"))
                frame_path = output_dir / "test_02_1024x768.png"
                with open(frame_path, 'wb') as f:
                    f.write(frame_bytes)
                print(f"    Frame: {len(frame_bytes)} bytes → {frame_path}")

            # Test 3: Rotate view
            print("[4] Rotating 45° on Y axis...")
            await ws.send(json.dumps({
                "type": "rotate",
                "data": {"axis": "y", "degrees": 45}
            }))

            response = await asyncio.wait_for(ws.recv(), timeout=30)
            data = json.loads(response)
            if data.get("type") == "frame":
                frame_bytes = base64.b64decode(data.get("data"))
                frame_path = output_dir / "test_03_rotated.png"
                with open(frame_path, 'wb') as f:
                    f.write(frame_bytes)
                print(f"    Frame: {len(frame_bytes)} bytes → {frame_path}")

            # Test 4: Get camera
            print("[5] Getting camera state...")
            await ws.send(json.dumps({"type": "get_camera"}))

            response = await asyncio.wait_for(ws.recv(), timeout=10)
            data = json.loads(response)
            if data.get("type") == "camera_update":
                camera = data.get("data", {})
                scale = camera.get("scale", [[]])[0]
                print(f"    Scale: {scale[:3] if len(scale) >= 3 else scale}")

            # Test 5: Reset view
            print("[6] Resetting view...")
            await ws.send(json.dumps({"type": "reset_view"}))

            response = await asyncio.wait_for(ws.recv(), timeout=30)
            data = json.loads(response)
            if data.get("type") == "frame":
                frame_bytes = base64.b64decode(data.get("data"))
                frame_path = output_dir / "test_04_reset.png"
                with open(frame_path, 'wb') as f:
                    f.write(frame_bytes)
                print(f"    Frame: {len(frame_bytes)} bytes → {frame_path}")

            # Test 6: Execute Tcl
            print("[7] Executing Tcl command...")
            await ws.send(json.dumps({
                "type": "execute_tcl",
                "data": {"command": "molinfo top get numatoms"}
            }))

            response = await asyncio.wait_for(ws.recv(), timeout=10)
            data = json.loads(response)
            if data.get("type") == "tcl_result":
                result = data.get("data", {}).get("result")
                print(f"    numatoms = {result}")

            # Test 7: Multiple rotation sequence
            print("[8] Rotation sequence (6 frames)...")
            for i in range(6):
                await ws.send(json.dumps({
                    "type": "rotate",
                    "data": {"axis": "y", "degrees": 30}
                }))
                response = await asyncio.wait_for(ws.recv(), timeout=30)
                data = json.loads(response)
                if data.get("type") == "frame":
                    frame_bytes = base64.b64decode(data.get("data"))
                    frame_path = output_dir / f"test_05_seq_{i:02d}.png"
                    with open(frame_path, 'wb') as f:
                        f.write(frame_bytes)
                    print(f"    Frame {i+1}: {len(frame_bytes)} bytes")

            print()
            print("=== All Tests Passed ===")
            print(f"Output images: {output_dir}")
            return True

    except ConnectionRefusedError:
        print("ERROR: Cannot connect to server. Is frame_server.py running?")
        print("Start it with: conda run -n vmd-env python frame_server.py")
        return False
    except asyncio.TimeoutError:
        print("ERROR: Timeout waiting for server response")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    asyncio.run(test_frame_server())
