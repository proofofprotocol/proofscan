/**
 * HTML Export Module (Phase 5.0)
 *
 * Exports standalone HTML reports for RPC and Session data.
 */

// Types
export {
  HTML_REPORT_SCHEMA_VERSION,
  DEFAULT_EMBED_MAX_BYTES,
  TRUNCATION_PREVIEW_LENGTH,
  DEFAULT_EXPORT_OPTIONS,
  toRpcStatus,
  getStatusSymbol,
  createPayloadData,
  getRpcHtmlFilename,
  getSessionHtmlFilename,
  getSpillFilename,
  getConnectorHtmlFilename,
} from './types.js';

export type {
  HtmlReportMeta,
  RpcStatus,
  HtmlExportOptions,
  PayloadData,
  HtmlRpcData,
  HtmlRpcReportV1,
  SessionRpcDetail,
  HtmlSessionData,
  HtmlSessionReportV1,
  // Connector HTML types (Phase 5.1)
  HtmlMcpCapabilities,
  HtmlMcpServerInfo,
  HtmlConnectorInfo,
  HtmlConnectorSessionRow,
  HtmlConnectorReportV1,
} from './types.js';

// Templates
export {
  escapeHtml,
  escapeJsonForScript,
  generateRpcHtml,
  generateSessionHtml,
  generateConnectorHtml,
} from './templates.js';

// Browser
export { openInBrowser } from './browser.js';

// Utilities
export {
  getPackageVersion,
  validateOutputPath,
  validateEmbedMaxBytes,
  ensureOutputDir,
  safeWriteFile,
} from './utils.js';
