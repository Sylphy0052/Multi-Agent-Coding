#!/usr/bin/env bash
set -euo pipefail

# setup.sh: Deploy rakuen files to /home/$USER/rakuen/ and configure PATH.
#
# Usage:
#   ./setup.sh [--force]
#
# Options:
#   --force   Overwrite existing deployment without confirmation

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="/home/$USER/rakuen"
FORCE=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --force) FORCE=true ;;
        --help|-h)
            echo "Usage: ./setup.sh [--force]"
            echo ""
            echo "Deploy rakuen files to $DEPLOY_DIR and configure PATH."
            echo ""
            echo "Options:"
            echo "  --force   Overwrite without confirmation"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo "=== Rakuen Setup ==="
echo "Source: $SCRIPT_DIR"
echo "Target: $DEPLOY_DIR"
echo ""

# Step 1: Check existing deployment
if [ -d "$DEPLOY_DIR" ]; then
    if [ "$FORCE" = false ]; then
        echo "WARNING: $DEPLOY_DIR already exists."
        read -r -p "Overwrite? (y/N) " confirm
        case "$confirm" in
            [yY][eE][sS]|[yY]) ;;
            *) echo "Aborted."; exit 0 ;;
        esac
    fi
    echo "INFO: Updating existing deployment..."
fi

# Step 2: Create target directory
mkdir -p "$DEPLOY_DIR"

# Step 3: Copy files (preserve .venv and logs if they exist)
echo "INFO: Copying files..."

# Copy directories, excluding runtime-only dirs
for dir in bin webui config prompts instructions templates; do
    if [ -d "$SCRIPT_DIR/$dir" ]; then
        mkdir -p "$DEPLOY_DIR/$dir"
        cp -r "$SCRIPT_DIR/$dir/." "$DEPLOY_DIR/$dir/"
    fi
done

# Copy CLAUDE.md (needed by agents for context reading)
if [ -f "$SCRIPT_DIR/CLAUDE.md" ]; then
    cp "$SCRIPT_DIR/CLAUDE.md" "$DEPLOY_DIR/CLAUDE.md"
fi

# Ensure static subdirectory is copied
if [ -d "$SCRIPT_DIR/webui/static" ]; then
    mkdir -p "$DEPLOY_DIR/webui/static"
    cp -r "$SCRIPT_DIR/webui/static/." "$DEPLOY_DIR/webui/static/"
fi

# Step 4: Set executable permissions
echo "INFO: Setting permissions..."
chmod +x "$DEPLOY_DIR/bin/rakuen-web"
chmod +x "$DEPLOY_DIR/bin/rakuen-launch"
if [ -f "$DEPLOY_DIR/bin/rakuen-agent-start" ]; then
    chmod +x "$DEPLOY_DIR/bin/rakuen-agent-start"
fi

# Step 5: Create venv if not exists
if [ ! -d "$DEPLOY_DIR/.venv" ]; then
    echo "INFO: Creating Python virtual environment..."
    python3 -m venv "$DEPLOY_DIR/.venv"
else
    echo "INFO: Virtual environment already exists, skipping."
fi

# Step 6: Create logs directory
mkdir -p "$DEPLOY_DIR/logs"

# Step 7: Add to PATH in .bashrc (idempotent)
BASHRC="$HOME/.bashrc"
PATH_LINE="export PATH=\"$DEPLOY_DIR/bin:\$PATH\""
MARKER="# rakuen-web PATH"

if ! grep -qF "$MARKER" "$BASHRC" 2>/dev/null; then
    echo "INFO: Adding $DEPLOY_DIR/bin to PATH in $BASHRC..."
    {
        echo ""
        echo "$MARKER"
        echo "$PATH_LINE"
    } >> "$BASHRC"
else
    echo "INFO: PATH entry already exists in $BASHRC, skipping."
fi

# Step 8: Verify
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Deployed to: $DEPLOY_DIR"
echo ""
echo "To activate PATH in current shell:"
echo "  source ~/.bashrc"
echo ""
echo "Then run from any git repo:"
echo "  rakuen-web"
echo ""

# Quick verify
if [ -x "$DEPLOY_DIR/bin/rakuen-web" ]; then
    echo "OK: rakuen-web is executable at $DEPLOY_DIR/bin/rakuen-web"
else
    echo "ERROR: rakuen-web is not executable" >&2
    exit 1
fi
