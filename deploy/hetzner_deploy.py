#!/usr/bin/env python3
"""
Hetzner Cloud VPS deployment script for MolViz backend.
"""

import requests
import json
import sys
import time
from pathlib import Path

# Load token
TOKEN_FILE = Path.home() / ".config/hetzner/token"
if not TOKEN_FILE.exists():
    print("Error: Hetzner token not found at ~/.config/hetzner/token")
    sys.exit(1)

API_TOKEN = TOKEN_FILE.read_text().strip()
BASE_URL = "https://api.hetzner.cloud/v1"
HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}

def api_get(endpoint):
    """GET request to Hetzner API."""
    resp = requests.get(f"{BASE_URL}/{endpoint}", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def api_post(endpoint, data):
    """POST request to Hetzner API."""
    resp = requests.post(f"{BASE_URL}/{endpoint}", headers=HEADERS, json=data)
    if not resp.ok:
        print(f"Error: {resp.status_code} - {resp.text}")
        resp.raise_for_status()
    return resp.json()

def list_server_types():
    """List available server types."""
    data = api_get("server_types")
    print("\nAvailable server types:")
    for t in data["server_types"][:10]:
        price = t["prices"][0]["price_monthly"]["gross"]
        print(f"  {t['name']:10} {t['cores']} vCPU, {t['memory']:5}GB RAM, €{price}/mo")

def list_images():
    """List available images."""
    data = api_get("images?type=system")
    print("\nAvailable images:")
    for img in data["images"]:
        if "ubuntu" in img["name"].lower():
            print(f"  {img['name']:30} ({img['description']})")

def list_locations():
    """List available locations."""
    data = api_get("locations")
    print("\nAvailable locations:")
    for loc in data["locations"]:
        print(f"  {loc['name']:6} - {loc['city']}, {loc['country']}")

def list_ssh_keys():
    """List SSH keys."""
    data = api_get("ssh_keys")
    print("\nSSH Keys:")
    for key in data["ssh_keys"]:
        print(f"  {key['id']}: {key['name']}")
    return data["ssh_keys"]

def create_ssh_key(name, public_key):
    """Create an SSH key."""
    data = api_post("ssh_keys", {
        "name": name,
        "public_key": public_key
    })
    print(f"Created SSH key: {data['ssh_key']['id']}")
    return data["ssh_key"]

def create_server(name, server_type="cx22", image="ubuntu-22.04", location="fsn1", ssh_keys=None):
    """Create a new server."""
    payload = {
        "name": name,
        "server_type": server_type,
        "image": image,
        "location": location,
        "start_after_create": True
    }
    if ssh_keys:
        payload["ssh_keys"] = ssh_keys

    print(f"\nCreating server '{name}'...")
    print(f"  Type: {server_type}")
    print(f"  Image: {image}")
    print(f"  Location: {location}")

    data = api_post("servers", payload)
    server = data["server"]
    root_password = data.get("root_password", "N/A (SSH key auth)")

    print(f"\nServer created!")
    print(f"  ID: {server['id']}")
    print(f"  IP: {server['public_net']['ipv4']['ip']}")
    print(f"  Status: {server['status']}")
    print(f"  Root Password: {root_password}")

    return server, root_password

def wait_for_server(server_id, timeout=120):
    """Wait for server to be running."""
    print("\nWaiting for server to be ready...", end="", flush=True)
    start = time.time()
    while time.time() - start < timeout:
        data = api_get(f"servers/{server_id}")
        status = data["server"]["status"]
        if status == "running":
            print(" Ready!")
            return data["server"]
        print(".", end="", flush=True)
        time.sleep(5)
    print(" Timeout!")
    return None

def main():
    if len(sys.argv) < 2:
        print("Usage: python hetzner_deploy.py <command>")
        print("\nCommands:")
        print("  list       - List server types, images, locations")
        print("  keys       - List SSH keys")
        print("  create     - Create MolViz backend server")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "list":
        list_server_types()
        list_images()
        list_locations()

    elif cmd == "keys":
        keys = list_ssh_keys()
        if not keys:
            print("\nNo SSH keys found. Add one in Hetzner Console or use:")
            print("  python hetzner_deploy.py addkey <name> <path_to_pubkey>")

    elif cmd == "addkey":
        if len(sys.argv) < 4:
            print("Usage: python hetzner_deploy.py addkey <name> <path_to_pubkey>")
            sys.exit(1)
        name = sys.argv[2]
        pubkey_path = Path(sys.argv[3]).expanduser()
        pubkey = pubkey_path.read_text().strip()
        create_ssh_key(name, pubkey)

    elif cmd == "create":
        # Get SSH keys
        keys = list_ssh_keys()
        ssh_key_ids = [k["id"] for k in keys] if keys else None

        if not ssh_key_ids:
            print("\nWarning: No SSH keys found. Server will use root password.")
            print("Consider adding an SSH key first with: python hetzner_deploy.py addkey")

        # Create server
        server, password = create_server(
            name="molviz-backend",
            server_type="cpx11",  # 2 vCPU, 2GB RAM, ~€5/mo (x86)
            image="ubuntu-22.04",
            location="ash",  # Ashburn, VA, US
            ssh_keys=ssh_key_ids
        )

        # Wait for it to be ready
        server = wait_for_server(server["id"])

        if server:
            ip = server["public_net"]["ipv4"]["ip"]
            print("\n" + "="*50)
            print("SERVER READY!")
            print("="*50)
            print(f"\nIP Address: {ip}")
            if password != "N/A (SSH key auth)":
                print(f"Root Password: {password}")
            print(f"\nSSH: ssh root@{ip}")
            print(f"\nTo setup MolViz backend, run:")
            print(f"  ssh root@{ip} 'curl -fsSL https://raw.githubusercontent.com/fl-sean03/molviz/main/deploy/setup-vps.sh | bash'")
            print(f"\nBackend URL will be: ws://{ip}:8765")

            # Save server info
            info_file = Path.home() / ".config/hetzner/molviz_server.json"
            info_file.write_text(json.dumps({
                "id": server["id"],
                "ip": ip,
                "ws_url": f"ws://{ip}:8765"
            }, indent=2))
            print(f"\nServer info saved to: {info_file}")

if __name__ == "__main__":
    main()
