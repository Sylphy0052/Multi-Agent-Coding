---
id: event-driven-refactor
version: "1.0"
created_at: "2026-01-30"
---
# skill: event-driven-refactor

## When to use
- Removing polling loops in favor of event-driven architecture
- Introducing fs.watch or chokidar for file-based task completion detection
- Refactoring synchronous status checks to event listeners

## Inputs
- Existing polling code (files, functions)
- Event source type (filesystem, IPC, WebSocket)
- Expected event payloads and frequency

## Steps
1. Identify all polling loops and their trigger conditions
2. Map each polling target to an equivalent event source (fs.watch, EventEmitter, SSE)
3. Define sentinel file contract (.done / .error) or event schema
4. Implement watcher with idempotent handler (re-processing same event is safe)
5. Add one-shot scan on startup to catch events missed before watcher registration
6. Remove polling code and verify no timer/interval references remain
7. Add integration test: emit event -> verify handler fires exactly once

## Output Contract
- Zero polling loops remain in modified code
- Watcher handles duplicate events idempotently
- Startup re-scan covers race window between process start and watcher registration
- Event handler errors are caught and logged without crashing the watcher

## Pitfalls
- Race condition: event fires before watcher is registered (mitigate with startup scan)
- Duplicate events from fs.watch (use debounce or dedup by file path + mtime)
- Watcher cleanup on shutdown (always call unwatch/close in cleanup path)
- Large directories may cause performance issues with recursive watchers
