#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install all dependencies (core + dev) for tests and linting
pip install -r "$CLAUDE_PROJECT_DIR/requirements.txt"
pip install -e "$CLAUDE_PROJECT_DIR[dev]"
