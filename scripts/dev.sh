#!/usr/bin/env bash
set -euo pipefail

# ─── Development Script ──────────────────────────────────
# Runs backend (tsx watch) + frontend (vite dev) concurrently.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }

# Load .env if exists
if [ -f .env ]; then
  info "Loading .env file..."
  set -a
  source .env
  set +a
fi

# Install dependencies
info "Installing dependencies..."
npm install --silent

# Build shared package first
info "Building shared package..."
cd shared && npx tsc && cd ..

info "Starting development servers..."
echo ""

# Start backend with tsx watch
(cd backend && npx tsx watch src/index.ts) &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start frontend dev server
(cd frontend && npx vite --host) &
FRONTEND_PID=$!

ok "Development servers started"
echo ""
echo -e "  Backend:  http://localhost:${ORCHESTRATOR_SERVER_PORT:-3000}/api"
echo -e "  Frontend: http://localhost:5173"
echo ""
echo "  Press Ctrl+C to stop both servers"

# Graceful shutdown
trap "echo ''; info 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; ok 'Stopped'; exit 0" INT TERM

wait
