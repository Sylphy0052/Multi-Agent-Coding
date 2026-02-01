#!/usr/bin/env python3
"""Command validator middleware for Rakuen.

Validates commands before they are sent to agents via tmux,
blocking dangerous patterns that could damage the system.
"""

import datetime
import os
import re


# ---------------------------------------------------------------------------
# Strict dangerous patterns
# ---------------------------------------------------------------------------

# FIX: Require start of line or command separator (;, |, &&) before
# dangerous commands. This prevents false positives when agents merely
# *discuss* or *explain* dangerous commands in conversational text.
PREFIX = r"(^|[;|&]\s*)"

DANGEROUS_PATTERNS = [
    # rm -rf / or ~ or $HOME
    PREFIX + r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+/",
    PREFIX + r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+~",
    PREFIX + r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+\$HOME",
    # Filesystem destruction
    PREFIX + r"mkfs\.",
    PREFIX + r"dd\s+.*of=/dev/",
    # Raw device writing
    PREFIX + r">\s*/dev/sd",
    # Recursive chmod 777 on root
    PREFIX + r"chmod\s+-R\s+777\s+/",
    # Fork bomb
    r":\(\)\s*\{\s*:\|:&\s*\}\s*;",
]


def load_blacklist(config_path):
    """Load additional blacklist patterns from a file.

    Each line in the file is treated as a regex pattern.
    Empty lines and lines starting with # are ignored.
    Returns a list of pattern strings.
    """
    patterns = []
    if not os.path.isfile(config_path):
        return patterns
    with open(config_path, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if stripped and not stripped.startswith("#"):
                patterns.append(stripped)
    return patterns


def validate_command(text, log_dir=None, extra_patterns=None):
    """Validate a command against dangerous patterns.

    Returns (is_safe, reason) where is_safe is True if the command
    is safe to execute, and reason describes why it was blocked.
    """
    if not text:
        return True, ""

    all_patterns = list(DANGEROUS_PATTERNS)
    if extra_patterns:
        all_patterns.extend(extra_patterns)

    for pattern in all_patterns:
        try:
            # Use MULTILINE to match start-of-line (^) in script blocks
            if re.search(pattern, text, re.IGNORECASE | re.MULTILINE):
                reason = f"Matched dangerous pattern: {pattern}"
                _log_blocked(text, reason, log_dir)
                return False, reason
        except re.error:
            # Skip invalid regex patterns
            continue

    return True, ""


def _log_blocked(text, reason, log_dir):
    """Log a blocked command to the validator log file."""
    if not log_dir:
        return
    log_path = os.path.join(log_dir, "validator.log")
    try:
        os.makedirs(log_dir, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] BLOCKED: {reason}\n")
            f.write(f"  Command: {text[:200]}\n")
    except OSError:
        pass
