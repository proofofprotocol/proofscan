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
  - Summary view (left) with method-aware parsing (tools/list, resources/list, prompts/list, initialize)
  - Raw JSON view (right) with syntax highlighting and path tracking
  - Req/Res toggle to switch between request and response views (synchronized highlighting)
  - Click-to-navigate: Summary items scroll to corresponding JSON path
  - Schema property styling: required (bold + *), default (green =), deprecated (strikethrough + badge)
  - Collapsible tools list with expand/collapse all controls (for 5+ tools)
  - RFC 6901 JSON Pointer paths for precise navigation
  - `initialize` method handler showing Server Info and Capabilities

- **Events View** (Issue #59): Protocol-level communication viewer
  - Toggle between RPC View and Events View for each session
  - Chronological display of all protocol events (requests, responses, notifications, transport events)
  - Direction arrows with color coding (⇨ blue = Client→Server, ⇦ green = Server→Client)
  - Kind badges (REQ, RES, NOTIF, TRANS) with distinct styling
  - Method/Summary column showing: method name, summary, or payload type (e.g., "connected")
  - Payload type extraction from raw_json for meaningful transport_event display
  - R:/E: counts in session list (RPC count and Event count)
  - Keyboard navigation support (↑/↓ to navigate, Enter to view details)
  - API endpoints: `/api/sessions/:id/events`, `/api/events/:id`

- **Web Monitor UX Refinements** (Phase 12)
  - Auto-check toggle with "New data available" notification banner (Phase 12.1)
  - Lightweight `/api/monitor/summary` endpoint for change detection with SHA-256 digest
  - "POPL" → "Ledger" badge terminology for clearer MCP/non-MCP distinction
  - Ledger modal with URL synchronization (`?ledger=xxx`) for context-preserving POPL viewing
  - Modal dropdown menu: Open in new window, Download JSON/YAML, Copy link
  - ESC key and overlay click to close modal
  - `/api/popl/:id/download` endpoint for JSON/YAML export
  - Compact sessions grid (1 session = 1 row) with UTC timestamps (Phase 12.x)
  - Adjusted layout widths for better readability (Phase 12.x-b)

- **Catalog Install**: `--version` option to specify package version
  - Override default version from catalog source
  - Support for CalVer format (e.g., `2026.1.14`)
  - Example: `pfs catalog install @modelcontextprotocol/server-everything --source npm --version 2026.1.14`

### Fixed

- **Critical**: Cross-connector data leakage in Web Monitor SQL queries
  - `rpc_id` is only unique within a session (composite PK with `session_id`)
  - Added `session_id` to JOIN conditions in `getServerInfo()`, `getProtocolInfo()`
  - Added `session_id` filter to events query in `buildSessionReport()`
- **JavaScript SyntaxError** in Web Monitor Connector detail page
  - Removed newline characters from `renderJsonWithPaths()` and `renderSummaryRowsHtml()` output
  - Added escape for backslash, newline, and carriage return in `escapeHtml()` for JS string safety
  - Prevents "Invalid regular expression flags" error when JSON contains regex-like strings
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
