# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.60] - 2026-01-24

### Fixed

- **Shell**: Use dynamic completer to avoid readline recreation (#71)

## [0.10.59] - 2026-01-24

### Fixed

- **Shell**: Close readline before recreating to prevent duplicate input (#70)

## [0.10.58] - 2026-01-23

### Added

- **Shell**: TAB completion for configure mode (#69)

## [0.10.57] - 2026-01-22

### Added

- **Configure**: Commit type distinction for better UX

### Fixed

- Consolidate CommitResult interface in types.ts

## [0.10.56] - 2026-01-21

### Added

- **Configure Mode**: iOS-style UX improvements (#67)
  - Test coverage for configure mode command handlers

## [0.10.55] - 2026-01-20

### Added

- **MCP Control Plane**: Configure mode for MCP servers (#66)
  - MCP Server Setup Guide documentation
- **Shell**: Pager (less/more) support for long output (#65)
  - External pager integration with proper readline reset
  - Terminal input buffer handling via tcflush

## [0.10.54] - 2026-01-19

### Added

- **Shell**: `find` command for cross-session search (#64)
- **Shell**: `where` command for filtering `ls` output (#63)
  - Field/rowType compatibility checks
  - tool_name extraction for tools/call RPC

## [0.10.53] - 2026-01-18

### Added

- **Web Monitor**: Wireshark-like filter DSL v0.1 (#62)
  - Comprehensive filter expression parser
  - XSS protection for filter errors and autocomplete
  - Performance optimizations

## [0.10.52] - 2026-01-18

### Fixed

- **Web Monitor**: Scroll synchronization between Summary and RAW panes

## [0.10.51] - 2026-01-18

### Fixed

- **Web Monitor**: JavaScript scroll isolation for Summary and RAW panes

## [0.10.50] - 2026-01-18

### Fixed

- **Web Monitor**: Revert height: 0 constraints that broke display

## [0.10.49] - 2026-01-18

### Fixed

- **Web Monitor**: Force height constraints with height: 0 + flex: 1 pattern

## [0.10.48] - 2026-01-18

### Fixed

- **Web Monitor**: Add CSS for rpc-details-container and rpc-detail-content

## [0.10.47] - 2026-01-17

### Fixed

- **Web Monitor**: Remove inline styles from Event detail panes

## [0.10.46] - 2026-01-17

### Fixed

- **Web Monitor**: Isolate scroll contexts for Summary and RAW panes

## [0.10.45] - 2026-01-17

### Fixed

- **Web Monitor**: Revert to flex layout for RPC Inspector panes

## [0.10.44] - 2026-01-17

### Fixed

- **Web Monitor**: Use absolute positioning for RPC Inspector panes

## [0.10.43] - 2026-01-17

### Fixed

- **Web Monitor**: RPC Inspector scroll and height containment

## [0.10.42] - 2026-01-17

### Fixed

- **Web Monitor**: RPC/Event view switching and RAW pane height issues

## [0.10.41] - 2026-01-17

### Changed

- Clean up unused imports and fix prefer-const warnings

## [0.10.40] - 2026-01-17

### Fixed

- Resolve ESLint errors for CI/CD

## [0.10.39] - 2026-01-17

### Fixed

- Resolve lint errors and warnings
- **Critical**: Pre-render RPC detail HTML to avoid JS string concatenation issues
- Escape U+2028/U+2029 in JSON and HTML for JS string safety
- **Web Monitor**: JavaScript SyntaxError in RPC Inspector

## [0.10.34] - 2026-01-16

### Added

- **Events View** (#59, #61): Protocol-level communication viewer
  - Toggle between RPC View and Events View for each session
  - Chronological display of all protocol events (requests, responses, notifications, transport events)
  - Direction arrows with color coding (⇨ blue = Client→Server, ⇦ green = Server→Client)
  - Kind badges (REQ, RES, NOTIF, TRANS) with distinct styling
  - payload_type extraction for meaningful transport_event display
  - R:/E: counts in session list (RPC count and Event count)
  - Keyboard navigation support (↑/↓ to navigate, Enter to view details)
- **Sensitive Key Detection** (#60): Warning badge for sensitive data in payloads (Phase 12.x-c)
  - XSS-safe tooltip for sensitive key paths
- **Session Grid**: Compact 1-row-per-session layout with UTC timestamps and milliseconds

## [0.10.33] - 2026-01-16

### Changed

- **Web Monitor**: Compact sessions grid view (Phase 12.x)
- Simplified session list to 3 columns with Ledger badge

## [0.10.32] - 2026-01-16

### Fixed

- Resolve runner commands to full paths on Windows

## [0.10.31] - 2026-01-15

### Fixed

- Add missing pagination info and redacted badge to connector HTML

## [0.10.30] - 2026-01-15

### Fixed

- Layout width adjustments for better readability (Phase 12.x-b)

## [0.10.29] - 2026-01-15

### Added

- **Web Monitor UX Refinements** (Phase 12) (#55)
  - Auto-check toggle with "New data available" notification banner (Phase 12.1)
  - Lightweight `/api/monitor/summary` endpoint for change detection with SHA-256 digest
  - "POPL" → "Ledger" badge terminology for clearer MCP/non-MCP distinction
  - Ledger modal with URL synchronization (`?ledger=xxx`) for context-preserving POPL viewing
  - Modal dropdown menu: Open in new window, Download JSON/YAML, Copy link
  - ESC key and overlay click to close modal
  - `/api/popl/:id/download` endpoint for JSON/YAML export

### Fixed

- **Critical**: Cross-connector data leakage in Web Monitor SQL queries
  - Added `session_id` to JOIN conditions in `getServerInfo()`, `getProtocolInfo()`
  - Added `session_id` filter to events query in `buildSessionReport()`

## [0.10.28] - 2026-01-15

### Added

- **RPC Inspector**: Wireshark-style 2-column JSON viewer for RPC analysis (#54)
  - Summary view (left) with method-aware parsing
  - Raw JSON view (right) with syntax highlighting and path tracking
  - Req/Res toggle to switch between request and response views
  - Click-to-navigate: Summary items scroll to corresponding JSON path
  - Schema property styling (required, default, deprecated)
  - Collapsible tools list with expand/collapse all controls

## [0.10.27] - 2026-01-15

### Added

- **Web Monitor**: Real-time web dashboard for monitoring MCP connectors (`pfs monitor start`) (#54)
  - Home page with connector cards, POPL KPIs, and aggregated analytics
  - Connector detail page with sessions, RPCs, and analytics graphs
  - POPL detail page with artifacts viewer
  - JSON API endpoints (`/api/connectors`, `/api/popl`, etc.)
  - Offline-first, read-only design with no CDN dependencies
- **Catalog Install**: `--version` option to specify package version
  - Support for CalVer format (e.g., `2026.1.14`)

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
