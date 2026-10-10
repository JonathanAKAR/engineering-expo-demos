#!/bin/bash
# Run the Research Vault demo scripts inside the labs Docker container.
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
echo "  Cy4Secure Research Vault Demo Runner"
echo "=================================================="
echo ""

# Copy scripts into the container
echo "[1/3] Copying demo scripts into labs container..."
sudo docker cp "$SCRIPT_DIR/research-vault-demo.mjs" "$CONTAINER:/challenge/labs/attack/"
sudo docker cp "$SCRIPT_DIR/stolen-db-viewer.mjs"    "$CONTAINER:/challenge/labs/attack/"
echo "  Done."

# Run the research vault demo
echo ""
echo "[2/3] Running research-vault-demo.mjs..."
echo ""
sudo docker exec "$CONTAINER" \
  node /challenge/labs/attack/research-vault-demo.mjs \
  2>&1 | tee "$SCRIPT_DIR/research-vault-output.txt"

echo ""
echo "  Output saved to: $SCRIPT_DIR/research-vault-output.txt"

# Run the stolen DB viewer
echo ""
echo "[3/3] Running stolen-db-viewer.mjs..."
echo ""
sudo docker exec "$CONTAINER" \
  node /challenge/labs/attack/stolen-db-viewer.mjs \
  2>&1 | tee "$SCRIPT_DIR/stolen-db-output.txt"

echo ""
echo "  Output saved to: $SCRIPT_DIR/stolen-db-output.txt"
echo ""
echo "=================================================="
echo "  All demos complete. Screenshots can be taken from:"
echo "    demo/index.html         (interactive web demo)"
echo "    sdk-scripts/*-output.txt (terminal output)"
echo "=================================================="
