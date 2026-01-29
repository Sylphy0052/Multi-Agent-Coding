#!/usr/bin/env bash
set -euo pipefail

# ─── Multi-Agent Coding Orchestration System - Start Script ──────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# ─── Dependency Check ────────────────────────────────────
info "Checking dependencies..."

command -v node   >/dev/null 2>&1 || fail "node is required but not installed"
command -v npm    >/dev/null 2>&1 || fail "npm is required but not installed"
command -v tmux   >/dev/null 2>&1 || fail "tmux is required but not installed"
command -v git    >/dev/null 2>&1 || fail "git is required but not installed"
command -v claude >/dev/null 2>&1 || warn "claude CLI not found - agent execution will fail"

NODE_VERSION=$(node -v)
ok "node $NODE_VERSION"
ok "npm $(npm -v)"
ok "tmux $(tmux -V)"
ok "git $(git --version | awk '{print $3}')"

# ─── Environment ─────────────────────────────────────────
if [ -f .env ]; then
  info "Loading .env file..."
  set -a
  source .env
  set +a
fi

PORT="${ORCHESTRATOR_SERVER_PORT:-3000}"
HOST="${ORCHESTRATOR_SERVER_HOST:-0.0.0.0}"

# ─── Install Dependencies ────────────────────────────────
info "Installing dependencies..."
npm install --silent

# ─── Build ────────────────────────────────────────────────
info "Building shared package..."
cd shared && npx tsc && cd ..

info "Building backend..."
cd backend && npx tsc && cd ..

info "Building frontend..."
cd frontend && npx vite build && cd ..

ok "All packages built successfully"

# ─── Initialize State Directory ───────────────────────────
STATE_DIR="${ORCHESTRATOR_STATE_DIR:-.orchestrator/state}"
info "Initializing state directory: $STATE_DIR"
mkdir -p "$STATE_DIR"

# ─── Start Backend ────────────────────────────────────────
info "Starting backend on http://${HOST}:${PORT} ..."
cd backend
node dist/index.js &
BACKEND_PID=$!
cd ..

# ─── Wait for Backend ────────────────────────────────────
info "Waiting for backend to start..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:${PORT}/api/health" > /dev/null 2>&1; then
    ok "Backend is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Backend failed to start within 30 seconds"
  fi
  sleep 1
done

# ─── Summary ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Multi-Agent Orchestrator is running!        ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  API:       http://localhost:${PORT}/api       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Health:    http://localhost:${PORT}/api/health ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Frontend:  serve frontend/dist separately   ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  PID:       ${BACKEND_PID}                           ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Press Ctrl+C to stop                       ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"

# ─── Graceful Shutdown ────────────────────────────────────
trap "echo ''; info 'Shutting down...'; kill $BACKEND_PID 2>/dev/null; ok 'Stopped'; exit 0" INT TERM

wait $BACKEND_PID
