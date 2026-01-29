#!/usr/bin/env bash
set -euo pipefail

# ─── Health Check Script ─────────────────────────────────
PORT="${ORCHESTRATOR_SERVER_PORT:-3000}"
HOST="${ORCHESTRATOR_SERVER_HOST:-localhost}"
URL="http://${HOST}:${PORT}/api/health"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Checking $URL ..."

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")

if [ "$RESPONSE" = "200" ]; then
  echo -e "${GREEN}[OK]${NC} API is healthy (HTTP $RESPONSE)"
  exit 0
else
  echo -e "${RED}[FAIL]${NC} API is not responding (HTTP $RESPONSE)"
  exit 1
fi
