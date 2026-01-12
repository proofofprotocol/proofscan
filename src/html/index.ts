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
} from './types.js';

// Templates
export {
  escapeHtml,
  escapeJsonForScript,
  generateRpcHtml,
  generateSessionHtml,
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
