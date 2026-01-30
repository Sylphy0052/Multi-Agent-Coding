---
id: repo-entrypoint-mapping
version: "1.0"
created_at: "2026-01-30"
---
# skill: repo-entrypoint-mapping

## When to use
- Investigating an unfamiliar repository structure
- Need to understand which files are entry points and how modules connect
- Onboarding to a new codebase or analyzing architecture

## Inputs
- Repository root path
- Package manager config (package.json, Cargo.toml, etc.)
- Build configuration files (tsconfig, webpack, vite, etc.)

## Steps
1. Identify package manager and build system from config files
2. Locate all entry points (main, bin, exports fields in package.json, or equivalent)
3. Trace top-level imports to map module dependency graph
4. Identify key architectural boundaries (routes, domain, infrastructure)
5. List external dependencies and their roles
6. Produce a concise entry point map with file paths and responsibilities

## Output Contract
- Entry point list with file paths and one-line descriptions
- Module dependency summary (which modules depend on which)
- Key architectural layers identified

## Pitfalls
- Do not assume a single entry point; check for multiple binaries or workers
- Monorepos may have multiple packages with separate entry points
- Dynamic imports and lazy loading may not appear in static analysis
