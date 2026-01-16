# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Web Monitor**: Real-time web dashboard for monitoring MCP connectors (`pfs monitor start`)
  - Home page with connector cards, POPL KPIs, and aggregated analytics (heatmap, method distribution)
  - Connector detail page with sessions, RPCs, and 4 analytics graphs
  - POPL detail page with artifacts viewer (`/popl/:proof_id`)
  - Mutual linking between connectors, sessions, and POPL entries
  - Session auto-selection via URL parameter (`?session=xxx`)
  - JSON API endpoints (`/api/connectors`, `/api/popl`, etc.)
  - Offline-first, read-only design with no CDN dependencies

- **RPC Inspector**: Wireshark-style 2-column JSON viewer for RPC analysis
  - Summary view (left) with method-aware parsing (tools/list, etc.)
  - Raw JSON view (right) with syntax highlighting and path tracking
  - Click-to-navigate: Summary items scroll to corresponding JSON path
  - Schema property styling: required (bold + *), default (green =), deprecated (strikethrough + badge)
  - Collapsible tools list with expand/collapse all controls (for 5+ tools)
  - RFC 6901 JSON Pointer paths for precise navigation

- **Catalog Install**: `--version` option to specify package version
  - Override default version from catalog source
  - Support for CalVer format (e.g., `2026.1.14`)
  - Example: `pfs catalog install @modelcontextprotocol/server-everything --source npm --version 2026.1.14`

### Fixed

- Catalog install now correctly uses npm registry versions instead of GitHub package.json versions

## [0.10.26] - 2026-01-15

### Added

- Analytics panel to connector HTML export with heatmap, latency histogram, top tools, and method distribution charts

## [0.10.25] - 2026-01-14

### Added

- Connector HTML export (`connectors show --html`)
- POPL and pfscan_reports folders to .gitignore

## [0.10.24] - 2026-01-13

### Added

- HTML export with 2-pane Wireshark-style layout for session analysis
- Neon blue accent color theme

## [0.10.23] - 2026-01-12

### Changed

- Code quality improvements and OSS readiness refactoring
- `pfs` and `psh` command aliases

### Added

- Builtin plans made undeletable with default plan support
- Events.db recording for plans execution

## [0.10.22] - 2026-01-11

### Added

- Validation plan system for MCP servers (#28)
- Plans command documentation
- i18n support (#47)

---

For older versions, see [git history](https://github.com/proofofprotocol/proofscan/commits/main).
