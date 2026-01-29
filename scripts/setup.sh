#!/usr/bin/env bash
set -euo pipefail

# ─── Multi-Agent Coding - Setup Script ───────────────────
# Checks prerequisites, installs dependencies, and builds the project.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ─── Prerequisite Checks ─────────────────────────────────

info "Checking prerequisites..."

# Node.js
if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Please install Node.js >= 20."
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js >= 20 required. Found: $(node -v)"
fi
info "Node.js $(node -v) OK"

# npm
if ! command -v npm &>/dev/null; then
  error "npm is not installed."
fi
info "npm $(npm -v) OK"

# tmux
if ! command -v tmux &>/dev/null; then
  warn "tmux is not installed. Task execution requires tmux."
else
  info "tmux $(tmux -V) OK"
fi

# git
if ! command -v git &>/dev/null; then
  error "git is not installed."
fi
info "git $(git --version | cut -d' ' -f3) OK"

# Claude CLI (optional)
if ! command -v claude &>/dev/null; then
  warn "Claude CLI is not installed. Task execution requires Claude CLI."
else
  info "Claude CLI found OK"
fi

# ─── Install Dependencies ────────────────────────────────

info "Installing dependencies..."
npm install

# ─── Build ────────────────────────────────────────────────

info "Building shared package..."
npm run build --workspace=shared

info "Building backend..."
npm run build --workspace=backend

info "Building frontend..."
npm run build --workspace=frontend

# ─── Config ───────────────────────────────────────────────

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    info "Created .env from .env.example. Please review and update settings."
  else
    warn "No .env.example found. Create .env manually if needed."
  fi
else
  info ".env already exists."
fi

# ─── State Directory ─────────────────────────────────────

STATE_DIR=".orchestrator/state"
if [ ! -d "$STATE_DIR" ]; then
  mkdir -p "$STATE_DIR"
  info "Created state directory: $STATE_DIR"
else
  info "State directory exists: $STATE_DIR"
fi

# ─── Done ─────────────────────────────────────────────────

echo ""
info "Setup complete!"
echo ""
echo "  Start (production): ./start.sh"
echo "  Start (dev):        ./scripts/dev.sh"
echo "  Run tests:          npx vitest run"
echo "  Health check:       ./scripts/health-check.sh"
echo ""
