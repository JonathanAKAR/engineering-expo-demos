#!/bin/bash
# Run the EternalBlue Exploit Vault demo inside the labs Docker container.
#
# Usage:
#   sudo bash run-demo.sh
#
# Prerequisites:
#   - Docker containers running (docker compose up -d)
#   - Credentials in ../credentials/
#   - Labs image loaded

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER="adam-savage-red-team-challenge-node-labs-1"

echo "=================================================="
echo "  Cy4Secure Exploit Vault Demo Runner"
echo "=================================================="
echo ""

# Copy script into the container
echo "[1/2] Copying demo script into labs container..."
sudo docker cp "$SCRIPT_DIR/exploit-vault-demo.mjs" "$CONTAINER:/challenge/labs/attack/"
echo "  Done."

# Run the exploit vault demo
echo ""
echo "[2/2] Running exploit-vault-demo.mjs..."
echo ""
sudo docker exec "$CONTAINER" \
  node /challenge/labs/attack/exploit-vault-demo.mjs \
  2>&1 | tee "$SCRIPT_DIR/exploit-vault-output.txt"

echo ""
echo "  Output saved to: $SCRIPT_DIR/exploit-vault-output.txt"
echo ""
echo "=================================================="
echo "  Demo complete. Screenshots can be taken from:"
echo "    demo/index.html                   (slideshow)"
echo "    sdk-scripts/exploit-vault-output.txt (terminal)"
echo "=================================================="
