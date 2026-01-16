/**
 * RPC Inspector - Wireshark-style JSON viewer with path tracking
 *
 * Phase 11.5: 2-column layout with Summary View (left) and Raw JSON View (right)
 * - JSON rendered with data-path attributes for click-to-navigate
 * - Method-aware summary generation (tools/list, etc.)
 * - RFC 6901 JSON Pointer paths
 */

import type { SummaryRow, MethodSummaryHandler } from './types.js';

// ============================================================================
// HTML Escaping Utilities
// ============================================================================

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Escape attribute value for data-path
 */
function escapeAttr(text: string): string {
  return escapeHtml(text);
}

// ============================================================================
// JSON Pointer Utilities (RFC 6901)
// ============================================================================

/**
 * Escape string for JSON Pointer (RFC 6901)
 * ~ → ~0, / → ~1
 */
export function escapeJsonPointer(str: string): string {
  return str.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Check if value is a primitive (string, number, boolean, null)
 */
function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

// ============================================================================
// JSON Renderer with Path Tracking
// ============================================================================

/**
 * Render primitive value inline (for same-line key-value pairs)
 */
function renderPrimitiveInline(value: unknown): string {
  if (value === null) {
    return '<span class="json-null">null</span>';
  }
  if (typeof value === 'boolean') {
    return `<span class="json-bool">${value}</span>`;
  }
  if (typeof value === 'number') {
    return `<span class="json-number">${value}</span>`;
  }
  if (typeof value === 'string') {
    return `<span class="json-string">"${escapeHtml(value)}"</span>`;
  }
  return escapeHtml(String(value));
}

/**
 * Render JSON value recursively with path tracking
 */
function renderValue(
  value: unknown,
  path: string,
  indent: number,
  lines: string[]
): void {
  const indentStr = '  '.repeat(indent);

  if (value === null) {
    lines.push(
      `<span class="json-line" data-path="${escapeAttr(path)}">${indentStr}<span class="json-null">null</span></span>`
    );
  } else if (typeof value === 'boolean') {
    lines.push(
      `<span class="json-line" data-path="${escapeAttr(path)}">${indentStr}<span class="json-bool">${value}</span></span>`
    );
  } else if (typeof value === 'number') {
    lines.push(
      `<span class="json-line" data-path="${escapeAttr(path)}">${indentStr}<span class="json-number">${value}</span></span>`
    );
  } else if (typeof value === 'string') {
    lines.push(
      `<span class="json-line" data-path="${escapeAttr(path)}">${indentStr}<span class="json-string">"${escapeHtml(value)}"</span></span>`
    );
  } else if (Array.isArray(value)) {
    renderArray(value, path, indent, lines);
  } else if (typeof value === 'object') {
    renderObject(value as Record<string, unknown>, path, indent, lines);
  }
}

/**
 * Render object with path tracking
 */
function renderObject(
  obj: Record<string, unknown>,
  path: string,
  indent: number,
  lines: string[]
): void {
  const indentStr = '  '.repeat(indent);
  const keys = Object.keys(obj);

  lines.push(
    `<span class="json-line json-bracket" data-path="${escapeAttr(path)}">${indentStr}{</span>`
  );

  keys.forEach((key, idx) => {
    const keyPath = `${path}/${escapeJsonPointer(key)}`;
    const value = obj[key];
    const comma = idx < keys.length - 1 ? ',' : '';
    const keyIndent = '  '.repeat(indent + 1);

    // For primitives, render key and value on same line
    if (isPrimitive(value)) {
      const valueHtml = renderPrimitiveInline(value);
      lines.push(
        `<span class="json-line" data-path="${escapeAttr(keyPath)}">${keyIndent}<span class="json-key">"${escapeHtml(key)}"</span>: ${valueHtml}${comma}</span>`
      );
    } else {
      // For objects/arrays, key on its own line with nested content
      lines.push(
        `<span class="json-line json-key-line" data-path="${escapeAttr(keyPath)}">${keyIndent}<span class="json-key">"${escapeHtml(key)}"</span>:</span>`
      );
      renderValue(value, keyPath, indent + 1, lines);
      // Add comma to last line if needed
      if (comma && lines.length > 0) {
        const lastIdx = lines.length - 1;
        lines[lastIdx] = lines[lastIdx].replace(/<\/span>$/, `${comma}</span>`);
      }
    }
  });

  lines.push(
    `<span class="json-line json-bracket" data-path="${escapeAttr(path)}">${indentStr}}</span>`
  );
}

/**
 * Render array with path tracking
 */
function renderArray(
  arr: unknown[],
  path: string,
  indent: number,
  lines: string[]
): void {
  const indentStr = '  '.repeat(indent);

  lines.push(
    `<span class="json-line json-bracket" data-path="${escapeAttr(path)}">${indentStr}[</span>`
  );

  arr.forEach((item, idx) => {
    const itemPath = `${path}/${idx}`;
    const comma = idx < arr.length - 1 ? ',' : '';

    if (isPrimitive(item)) {
      const itemIndent = '  '.repeat(indent + 1);
      const valueHtml = renderPrimitiveInline(item);
      lines.push(
        `<span class="json-line" data-path="${escapeAttr(itemPath)}">${itemIndent}${valueHtml}${comma}</span>`
      );
    } else {
      renderValue(item, itemPath, indent + 1, lines);
      if (comma && lines.length > 0) {
        const lastIdx = lines.length - 1;
        lines[lastIdx] = lines[lastIdx].replace(/<\/span>$/, `${comma}</span>`);
      }
    }
  });

  lines.push(
    `<span class="json-line json-bracket" data-path="${escapeAttr(path)}">${indentStr}]</span>`
  );
}

/**
 * Render JSON as HTML with line-level data-path attributes
 *
 * @param json - The JSON object to render
 * @param pathPrefix - Base path (e.g., "#" for root)
 * @returns HTML string with span elements containing data-path
 */
export function renderJsonWithPaths(
  json: unknown,
  pathPrefix: string = '#'
): string {
  if (json === null || json === undefined) {
    return '<span class="json-line json-null" data-path="#">(no data)</span>';
  }

  const lines: string[] = [];
  renderValue(json, pathPrefix, 0, lines);
  return lines.join('\n');
}

// ============================================================================
// Method Summary Registry
// ============================================================================

/**
 * Registry of method-specific summary handlers
 */
const methodHandlers: MethodSummaryHandler[] = [];

/**
 * Register a method-specific summary handler
 */
export function registerMethodHandler(handler: MethodSummaryHandler): void {
  methodHandlers.push(handler);
}

/**
 * Render method-specific summary
 */
export function renderMethodSummary(
  method: string,
  request: unknown,
  response: unknown
): SummaryRow[] {
  for (const handler of methodHandlers) {
    if (typeof handler.method === 'string' && handler.method === method) {
      return handler.render(request, response);
    }
    if (handler.method instanceof RegExp && handler.method.test(method)) {
      return handler.render(request, response);
    }
  }
  // Default: show generic summary
  return renderGenericSummary(method, request, response);
}

/**
 * Generic summary for unknown methods
 */
function renderGenericSummary(
  method: string,
  request: unknown,
  response: unknown
): SummaryRow[] {
  const rows: SummaryRow[] = [];

  rows.push({
    type: 'header',
    label: `Method: ${method}`,
    cssClass: 'summary-method-header',
  });

  // Show request params if present
  const req = request as { params?: Record<string, unknown> } | null;
  if (req?.params && typeof req.params === 'object') {
    const paramKeys = Object.keys(req.params);
    if (paramKeys.length > 0) {
      rows.push({
        type: 'header',
        label: 'Request Parameters',
        cssClass: 'summary-section-header',
      });
      paramKeys.forEach((key) => {
        rows.push({
          type: 'property',
          label: key,
          value: summarizeValue(req.params![key]),
          pointer: {
            target: 'request',
            path: `#/params/${escapeJsonPointer(key)}`,
          },
        });
      });
    }
  }

  // Show response result summary
  const res = response as { result?: unknown; error?: unknown } | null;
  if (res?.result !== undefined) {
    rows.push({
      type: 'header',
      label: 'Response Result',
      cssClass: 'summary-section-header',
    });
    rows.push({
      type: 'property',
      label: 'result',
      value: summarizeValue(res.result),
      pointer: {
        target: 'response',
        path: '#/result',
      },
    });
  }

  if (res?.error !== undefined) {
    rows.push({
      type: 'header',
      label: 'Error',
      cssClass: 'summary-section-header summary-error',
    });
    rows.push({
      type: 'property',
      label: 'error',
      value: summarizeValue(res.error),
      pointer: {
        target: 'response',
        path: '#/error',
      },
      cssClass: 'summary-error-item',
    });
  }

  return rows;
}

/**
 * Summarize a value for display (truncate if needed)
 */
function summarizeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return value.length > 50 ? `"${value.slice(0, 47)}..."` : `"${value}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return `Object(${keys.length} keys)`;
  }
  return String(value);
}

// ============================================================================
// tools/list Summary Handler
// ============================================================================

interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<
      string,
      {
        type?: string;
        description?: string;
        default?: unknown;
        deprecated?: boolean;
      }
    >;
    required?: string[];
  };
}

/**
 * Register tools/list handler
 */
registerMethodHandler({
  method: 'tools/list',
  render: (_request: unknown, response: unknown): SummaryRow[] => {
    const rows: SummaryRow[] = [];

    // Extract tools from response.result.tools
    const res = response as { result?: { tools?: ToolInfo[] } } | null;
    const tools = res?.result?.tools ?? [];

    if (tools.length === 0) {
      rows.push({
        type: 'header',
        label: 'No tools available',
      });
      return rows;
    }

    // Table header with collapse controls (only if many tools)
    const showCollapseControls = tools.length > 5;
    rows.push({
      type: 'header',
      label: `Tools (${tools.length})`,
      cssClass: `summary-table-header${showCollapseControls ? ' summary-collapsible-header' : ''}`,
    });

    // Tool rows
    tools.forEach((tool, idx) => {
      const toolRow: SummaryRow = {
        type: 'item',
        label: tool.name,
        value: tool.description || '(no description)',
        pointer: {
          target: 'response',
          path: `#/result/tools/${idx}`,
        },
        cssClass: 'summary-tool-row',
      };

      // Add inputSchema properties as children
      if (tool.inputSchema?.properties) {
        toolRow.children = renderInputSchemaRows(
          tool.inputSchema,
          `#/result/tools/${idx}/inputSchema`
        );
      }

      rows.push(toolRow);
    });

    return rows;
  },
});

/**
 * Render inputSchema properties as summary rows
 */
function renderInputSchemaRows(
  schema: NonNullable<ToolInfo['inputSchema']>,
  basePath: string
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  Object.entries(props).forEach(([name, propSchema]) => {
    const isRequired = required.has(name);
    const isDeprecated = propSchema.deprecated === true;
    const hasDefault = propSchema.default !== undefined;
    const typeStr = propSchema.type ?? 'any';

    // Build value string with badges
    const badges: string[] = [];
    if (isRequired) badges.push('required');
    if (hasDefault) badges.push(`default: ${JSON.stringify(propSchema.default)}`);
    if (isDeprecated) badges.push('deprecated');

    const valueStr = badges.length > 0 ? `${typeStr} (${badges.join(', ')})` : typeStr;

    // Build CSS class
    const cssClasses: string[] = [];
    if (isRequired) cssClasses.push('schema-required');
    else cssClasses.push('schema-optional');
    if (hasDefault) cssClasses.push('schema-has-default');
    if (isDeprecated) cssClasses.push('schema-deprecated');

    rows.push({
      type: 'property',
      label: name,
      value: valueStr,
      pointer: {
        target: 'response',
        path: `${basePath}/properties/${escapeJsonPointer(name)}`,
      },
      cssClass: cssClasses.join(' '),
    });
  });

  return rows;
}

// ============================================================================
// Summary Row HTML Renderer
// ============================================================================

/**
 * Render summary rows to HTML
 */
export function renderSummaryRowsHtml(rows: SummaryRow[]): string {
  const html: string[] = [];

  for (const row of rows) {
    html.push(renderSummaryRow(row));
  }

  return html.join('\n');
}

/**
 * Render a single summary row
 */
function renderSummaryRow(row: SummaryRow): string {
  const cssClass = row.cssClass || '';
  const pointerAttrs = row.pointer
    ? ` data-pointer-target="${row.pointer.target}" data-pointer-path="${escapeAttr(row.pointer.path)}"`
    : '';
  const clickable = row.pointer ? ' clickable' : '';
  // Add title attribute for tooltip on truncated values
  const valueTitle = row.value ? ` title="${escapeAttr(row.value)}"` : '';

  if (row.type === 'header') {
    // Add collapse controls if header has collapsible class
    if (cssClass.includes('summary-collapsible-header')) {
      return `<div class="summary-row summary-header ${cssClass}">
  <span>${escapeHtml(row.label)}</span>
  <span class="collapse-controls">
    <button class="collapse-btn collapse-all" title="Collapse all">−</button>
    <button class="collapse-btn expand-all" title="Expand all">+</button>
  </span>
</div>`;
    }
    return `<div class="summary-row summary-header ${cssClass}">${escapeHtml(row.label)}</div>`;
  }

  if (row.type === 'item') {
    const hasChildren = row.children && row.children.length > 0;
    let childHtml = '';
    let toggleHtml = '';

    if (hasChildren) {
      childHtml = `<div class="summary-children">${row.children!.map((c) => renderSummaryRow(c)).join('\n')}</div>`;
      toggleHtml = '<span class="item-toggle" title="Toggle properties">▼</span>';
    }

    return `<div class="summary-row summary-item ${cssClass}${clickable}${hasChildren ? ' has-children' : ''}"${pointerAttrs}>
  ${toggleHtml}<span class="summary-label">${escapeHtml(row.label)}</span>
  <span class="summary-value"${valueTitle}>${escapeHtml(row.value || '')}</span>
</div>${childHtml}`;
  }

  // property type
  return `<div class="summary-row summary-property ${cssClass}${clickable}"${pointerAttrs}>
  <span class="summary-prop-name">${escapeHtml(row.label)}</span>
  <span class="summary-prop-value"${valueTitle}>${escapeHtml(row.value || '')}</span>
</div>`;
}

// ============================================================================
// CSS Styles for RPC Inspector
// ============================================================================

/**
 * Get RPC Inspector CSS styles
 */
export function getRpcInspectorStyles(): string {
  return `
    /* RPC Info horizontal layout */
    .rpc-info-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 16px 32px;
      align-items: center;
      margin-bottom: 16px;
    }

    .rpc-info-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .rpc-info-item dt {
      font-size: 12px;
      color: var(--text-secondary);
      font-weight: 400;
    }

    .rpc-info-item dd {
      margin: 0;
    }

    /* Right pane layout adjustments for RPC Inspector */
    .right-pane {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .right-pane .detail-section:first-child {
      flex-shrink: 0;
    }

    .right-pane .detail-section:last-child {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      margin-bottom: 0;
    }

    /* 2-column RPC detail layout - fill available space */
    .rpc-inspector {
      display: flex;
      gap: 16px;
      flex: 1;
      min-height: 0;
    }

    .rpc-inspector-summary {
      flex: 0 0 45%;
      min-width: 280px;
      max-width: 500px;
      overflow-y: auto;
      overflow-x: hidden;
      border-right: 1px solid var(--border-color);
      padding-right: 16px;
    }

    .rpc-inspector-summary h3 {
      position: sticky;
      top: 0;
      background: var(--bg-primary);
      padding: 8px 0;
      margin: 0 0 8px 0;
      z-index: 1;
    }

    .rpc-inspector-raw {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }

    /* Toggle buttons */
    .rpc-toggle-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      flex-shrink: 0;
    }

    .rpc-toggle-btn {
      padding: 6px 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s;
    }

    .rpc-toggle-btn:hover {
      border-color: var(--accent-blue);
      color: var(--text-primary);
    }

    .rpc-toggle-btn.active {
      background: rgba(0, 212, 255, 0.15);
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    /* Raw JSON container - independent scroll */
    .rpc-raw-json {
      flex: 1;
      overflow-y: auto;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
    }

    /* JSON line styling */
    .json-line {
      display: block;
      white-space: pre;
      padding: 1px 4px;
      border-radius: 2px;
      transition: background-color 0.15s;
    }

    .json-line:hover {
      background: rgba(0, 212, 255, 0.05);
    }

    .json-line.highlighted {
      background: rgba(0, 212, 255, 0.2);
      outline: 1px solid var(--accent-blue);
    }

    /* JSON syntax highlighting */
    .json-key { color: #79c0ff; }
    .json-string { color: #a5d6ff; }
    .json-number { color: #ffa657; }
    .json-bool { color: #ff7b72; }
    .json-null { color: var(--text-secondary); }
    .json-bracket { color: var(--text-secondary); }

    /* Summary view styles */
    .summary-row {
      padding: 4px 0;
    }

    .summary-header {
      font-weight: 600;
      font-size: 14px;
      color: var(--text-primary);
      padding: 8px 0 4px 0;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 8px;
      margin-top: 12px;
    }

    .summary-header:first-child {
      margin-top: 0;
    }

    .summary-table-header {
      font-size: 13px;
    }

    .summary-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 8px 12px;
      margin: 4px 0;
      background: var(--bg-secondary);
      border: 1px solid transparent;
      border-radius: 4px;
      transition: border-color 0.15s, background 0.15s;
    }

    .summary-item.clickable {
      cursor: pointer;
    }

    .summary-item.clickable:hover {
      border-color: var(--accent-blue);
      background: rgba(0, 212, 255, 0.05);
    }

    .summary-item.selected {
      border-color: var(--accent-blue);
      background: rgba(0, 212, 255, 0.1);
    }

    .summary-label {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 13px;
      color: var(--accent-blue);
      font-weight: 500;
    }

    .summary-value {
      font-size: 12px;
      color: var(--text-secondary);
      max-width: 55%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: right;
    }

    /* Schema properties (children) */
    .summary-children {
      margin-left: 16px;
      padding-left: 12px;
      border-left: 2px solid var(--border-color);
      margin-top: 4px;
    }

    .summary-property {
      display: flex;
      gap: 8px;
      padding: 4px 8px;
      margin: 2px 0;
      font-size: 12px;
      border-radius: 3px;
      transition: background 0.15s;
    }

    .summary-property.clickable {
      cursor: pointer;
    }

    .summary-property.clickable:hover {
      background: rgba(0, 212, 255, 0.05);
    }

    .summary-prop-name {
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: var(--text-primary);
    }

    .schema-required .summary-prop-name::after {
      content: '*';
      color: #f85149;
      margin-left: 2px;
    }

    .schema-required .summary-prop-name {
      font-weight: 600;
    }

    .schema-has-default .summary-prop-value::before {
      content: '=';
      color: #7ee787;
      margin-right: 4px;
      font-weight: 500;
    }

    .schema-deprecated {
      opacity: 0.6;
    }

    .schema-deprecated .summary-prop-name {
      text-decoration: line-through;
      color: #f0883e;
    }

    .schema-deprecated .summary-prop-value::after {
      content: 'deprecated';
      background: rgba(240, 136, 62, 0.2);
      color: #f0883e;
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 6px;
    }

    .summary-prop-value {
      color: var(--text-secondary);
    }

    /* Collapse controls */
    .summary-collapsible-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .collapse-controls {
      display: flex;
      gap: 4px;
    }

    .collapse-btn {
      width: 20px;
      height: 20px;
      border: 1px solid var(--border-color);
      border-radius: 3px;
      background: var(--bg-secondary);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .collapse-btn:hover {
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    /* Item toggle */
    .item-toggle {
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 10px;
      margin-right: 8px;
      transition: transform 0.15s;
      user-select: none;
    }

    .summary-item.collapsed .item-toggle {
      transform: rotate(-90deg);
    }

    .summary-item.collapsed + .summary-children {
      display: none;
    }

    /* Error styling */
    .summary-error {
      color: #f85149;
    }

    .summary-error-item {
      border-left: 3px solid #f85149;
    }

    /* No-JS fallback */
    noscript + .rpc-toggle-bar {
      display: none;
    }
  `;
}

// ============================================================================
// JavaScript for RPC Inspector Interaction
// ============================================================================

/**
 * Get RPC Inspector JavaScript
 */
export function getRpcInspectorScript(): string {
  return `
    // RPC Inspector - Toggle and Navigation
    (function() {
      let currentTarget = 'request';

      // Initialize toggle buttons
      function initInspectorToggle() {
        const reqBtn = document.getElementById('toggle-req');
        const resBtn = document.getElementById('toggle-res');

        if (reqBtn) {
          reqBtn.addEventListener('click', function() { switchTarget('request'); });
        }
        if (resBtn) {
          resBtn.addEventListener('click', function() { switchTarget('response'); });
        }
      }

      // Switch between request and response view
      function switchTarget(target) {
        currentTarget = target;

        // Update button states
        const reqBtn = document.getElementById('toggle-req');
        const resBtn = document.getElementById('toggle-res');
        if (reqBtn) reqBtn.classList.toggle('active', target === 'request');
        if (resBtn) resBtn.classList.toggle('active', target === 'response');

        // Update raw JSON display
        const reqJson = document.getElementById('raw-json-request');
        const resJson = document.getElementById('raw-json-response');

        if (reqJson) reqJson.style.display = target === 'request' ? 'block' : 'none';
        if (resJson) resJson.style.display = target === 'response' ? 'block' : 'none';
      }

      // Navigate to JSON path and highlight
      function navigateToPath(target, path) {
        // Switch to correct target first
        switchTarget(target);

        // Find container for this target
        const container = document.getElementById('raw-json-' + target);
        if (!container) return;

        // Clear previous highlights
        container.querySelectorAll('.highlighted').forEach(function(el) {
          el.classList.remove('highlighted');
        });

        // Find and highlight the target line
        const escapedPath = CSS.escape(path);
        const targetLine = container.querySelector('[data-path="' + path + '"]');
        if (targetLine) {
          targetLine.classList.add('highlighted');
          targetLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      // Summary row click handler
      function initSummaryClicks() {
        document.querySelectorAll('[data-pointer-target]').forEach(function(el) {
          el.addEventListener('click', function(e) {
            // Don't navigate if clicking on toggle
            if (e.target.classList.contains('item-toggle')) return;

            const target = el.dataset.pointerTarget;
            const path = el.dataset.pointerPath;
            if (target && path) {
              navigateToPath(target, path);

              // Mark as selected
              document.querySelectorAll('.summary-item.selected, .summary-property.selected').forEach(function(s) {
                s.classList.remove('selected');
              });
              el.classList.add('selected');
            }
          });
        });
      }

      // Item toggle (expand/collapse single tool)
      function initItemToggles() {
        document.querySelectorAll('.summary-item.has-children .item-toggle').forEach(function(toggle) {
          toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const item = toggle.closest('.summary-item');
            if (item) {
              item.classList.toggle('collapsed');
            }
          });
        });
      }

      // Collapse/Expand all buttons
      function initCollapseControls() {
        document.querySelectorAll('.collapse-all').forEach(function(btn) {
          btn.addEventListener('click', function() {
            document.querySelectorAll('.summary-item.has-children').forEach(function(item) {
              item.classList.add('collapsed');
            });
          });
        });

        document.querySelectorAll('.expand-all').forEach(function(btn) {
          btn.addEventListener('click', function() {
            document.querySelectorAll('.summary-item.has-children').forEach(function(item) {
              item.classList.remove('collapsed');
            });
          });
        });
      }

      // Expose for re-initialization after dynamic content update
      window.initRpcInspector = function() {
        initInspectorToggle();
        initSummaryClicks();
        initItemToggles();
        initCollapseControls();
      };

      // Initialize on DOM ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.initRpcInspector);
      } else {
        window.initRpcInspector();
      }
    })();
  `;
}
