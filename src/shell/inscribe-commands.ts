/**
 * Shell inscribe commands (Phase 4.3)
 *
 * Inscribes RPC call details to an external inscribe-mcp server.
 *
 * Usage:
 * - inscribe @rpc:<id>           Inscribe a specific RPC call
 * - inscribe @ref:<name>         Inscribe from saved reference
 * - inscribe @last               Inscribe the latest RPC call
 * - show @rpc:<id> --json | inscribe   Inscribe from piped JSON
 *
 * Options:
 * - --dry-run                    Show payload without sending
 * - --json                       Output receipt as JSON
 */

import type { ShellContext } from './types.js';
import { printSuccess, printError, printInfo, dimText } from './prompt.js';
import { ConfigManager } from '../config/index.js';
import { EventsStore } from '../db/events-store.js';
import {
  RefResolver,
  createRefDataProvider,
  parseRef,
  isRef,
  type RefStruct,
} from './ref-resolver.js';
import {
  getConnector,
  listTools,
  callTool,
  type ToolContext,
} from '../tools/adapter.js';
import { redactDeep } from '../secrets/redaction.js';
import { isSecretKey } from '../secrets/detection.js';
import type { InscriberConfig } from '../types/config.js';

/** Default inscriber connector ID */
const DEFAULT_INSCRIBER_CONNECTOR = 'inscribe';

/** Default inscriber tool name */
const DEFAULT_INSCRIBER_TOOL = 'inscribe';

/** Default inscription type */
const DEFAULT_INSCRIPTION_TYPE = 'proofscan.rpc';

/** Custom redaction placeholder for inscribe payloads */
const INSCRIBE_REDACTED = '***';

/**
 * RPC detail structure for inscribe payload
 */
interface RpcDetailPayload {
  request: unknown;
  response: unknown;
  method: string;
}

/**
 * Inscribe payload structure
 */
interface InscribePayload {
  ref: RefStruct;
  rpc: RpcDetailPayload;
  meta: {
    source: 'proofscan';
    proto: string;
    captured_at: string;
    replay: boolean;
  };
}

/**
 * Inscribe receipt from inscribe-mcp
 */
interface InscribeReceipt {
  success?: boolean;
  inscription_id?: string;
  verify_url?: string;
  [key: string]: unknown;
}

/**
 * Redact secrets in an object for inscription
 * Uses existing redactDeep but with "***" as the redaction placeholder
 *
 * @param value - Value to redact
 * @returns Redacted value and count
 */
export function redactForInscribe(value: unknown): { value: unknown; count: number } {
  // Use redactDeep with custom options for "***" placeholder
  const result = redactDeep(value, {
    redactSecretKeys: true,
    redactSecretRefs: true,
    redactedValue: INSCRIBE_REDACTED,
    redactedRef: INSCRIBE_REDACTED,
  });
  return result;
}

/**
 * Build inscribe payload from RPC data
 */
function buildPayload(
  ref: RefStruct,
  rpcData: {
    rpc: { method: string; request_ts: string };
    request?: { raw_json: string | null };
    response?: { raw_json: string | null };
  }
): { payload: InscribePayload; redactedCount: number } {
  // Parse request/response JSON
  let requestJson: unknown = null;
  let responseJson: unknown = null;

  if (rpcData.request?.raw_json) {
    try {
      requestJson = JSON.parse(rpcData.request.raw_json);
    } catch {
      requestJson = rpcData.request.raw_json;
    }
  }

  if (rpcData.response?.raw_json) {
    try {
      responseJson = JSON.parse(rpcData.response.raw_json);
    } catch {
      responseJson = rpcData.response.raw_json;
    }
  }

  // Build payload
  const rawPayload: InscribePayload = {
    ref: {
      kind: ref.kind,
      connector: ref.connector,
      session: ref.session,
      rpc: ref.rpc,
      proto: ref.proto,
      level: ref.level,
      captured_at: ref.captured_at,
    },
    rpc: {
      request: requestJson,
      response: responseJson,
      method: rpcData.rpc.method,
    },
    meta: {
      source: 'proofscan',
      proto: ref.proto || 'mcp',
      captured_at: ref.captured_at || rpcData.rpc.request_ts,
      replay: false,
    },
  };

  // Redact secrets
  const { value: redactedPayload, count } = redactForInscribe(rawPayload);

  return {
    payload: redactedPayload as InscribePayload,
    redactedCount: count,
  };
}

/**
 * Build payload from stdin JSON (show --json output)
 *
 * Expected format: RPC detail JSON with request_json/response_json
 */
function buildPayloadFromStdin(stdinJson: string): {
  payload: InscribePayload;
  redactedCount: number;
} | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdinJson);
  } catch {
    return { error: 'Invalid JSON input' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'Input must be a JSON object' };
  }

  const data = parsed as Record<string, unknown>;

  // Check if this is RPC detail JSON (has request_json/response_json)
  if (!('request_json' in data)) {
    // Check if it's a RefStruct (only has kind, connector, session, etc.)
    if ('kind' in data && !('rpc' in data && typeof data.rpc === 'object')) {
      return {
        error: 'RefStruct input not supported for inscribe. Use: show @rpc:<id> --json | inscribe',
      };
    }
    return { error: 'Input must be RPC detail JSON (use: show @rpc:<id> --json)' };
  }

  // Extract required fields
  const rpcId = data.rpc_id as string | undefined;
  const sessionId = data.session_id as string | undefined;
  const connectorId = data.connector_id as string | undefined;
  const method = data.method as string | undefined;
  const requestTs = data.request_ts as string | undefined;

  if (!method) {
    return { error: 'Missing method in RPC detail JSON' };
  }

  // Build ref
  const ref: RefStruct = {
    kind: 'rpc',
    connector: connectorId,
    session: sessionId,
    rpc: rpcId,
    proto: 'mcp',
    captured_at: requestTs || new Date().toISOString(),
  };

  // Build payload
  const rawPayload: InscribePayload = {
    ref,
    rpc: {
      request: data.request_json,
      response: data.response_json ?? null,
      method,
    },
    meta: {
      source: 'proofscan',
      proto: 'mcp',
      captured_at: requestTs || new Date().toISOString(),
      replay: false,
    },
  };

  // Redact secrets
  const { value: redactedPayload, count } = redactForInscribe(rawPayload);

  return {
    payload: redactedPayload as InscribePayload,
    redactedCount: count,
  };
}

/**
 * Parse inscribe receipt from MCP response
 *
 * inscribe-mcp returns: { content: [{ type: 'text', text: JSON.stringify(result) }] }
 */
function parseReceipt(content: unknown[]): { receipt: InscribeReceipt; raw?: string } {
  if (!content || !Array.isArray(content) || content.length === 0) {
    return { receipt: { success: false }, raw: 'Empty response' };
  }

  const firstItem = content[0] as { type?: string; text?: string };
  if (firstItem?.type !== 'text' || !firstItem.text) {
    return { receipt: { success: false }, raw: JSON.stringify(content) };
  }

  try {
    const parsed = JSON.parse(firstItem.text);
    return { receipt: parsed as InscribeReceipt };
  } catch {
    return { receipt: { success: false }, raw: firstItem.text };
  }
}

/**
 * Handle 'inscribe' command
 */
export async function handleInscribe(
  args: string[],
  context: ShellContext,
  configPath: string,
  stdinData?: string
): Promise<void> {
  const isJson = args.includes('--json');
  const isDryRun = args.includes('--dry-run');
  const target = args.find(a => !a.startsWith('-'));

  // Handle stdin input (pipe mode)
  if (stdinData) {
    await handleInscribeFromStdin(stdinData, configPath, isJson, isDryRun);
    return;
  }

  // Require target reference
  if (!target) {
    printInfo('Usage: inscribe <@ref> [options]');
    printInfo('');
    printInfo('Inscribe RPC call details to blockchain:');
    printInfo('  inscribe @rpc:<id>          Inscribe specific RPC');
    printInfo('  inscribe @ref:<name>        Inscribe from saved reference');
    printInfo('  inscribe @last              Inscribe latest RPC');
    printInfo('');
    printInfo('Pipe mode:');
    printInfo('  show @rpc:<id> --json | inscribe');
    printInfo('');
    printInfo('Options:');
    printInfo('  --dry-run                   Show payload without sending');
    printInfo('  --json                      Output receipt as JSON');
    return;
  }

  // Validate target is a reference
  if (!isRef(target)) {
    printError(`Not a valid reference: ${target}`);
    printInfo('Use: @rpc:<id>, @ref:<name>, or @last');
    return;
  }

  await handleInscribeFromRef(target, context, configPath, isJson, isDryRun);
}

/**
 * Handle inscribe from reference target
 */
async function handleInscribeFromRef(
  refString: string,
  context: ShellContext,
  configPath: string,
  isJson: boolean,
  isDryRun: boolean
): Promise<void> {
  const manager = new ConfigManager(configPath);
  const eventsStore = new EventsStore(manager.getConfigDir());
  const dataProvider = createRefDataProvider(eventsStore);
  const resolver = new RefResolver(dataProvider);

  // Resolve the reference
  const parsed = parseRef(refString);
  let rpcId: string | undefined;
  let sessionId: string | undefined;
  let connectorId: string | undefined;

  if (parsed.type === 'last') {
    const result = resolver.resolveLast(context);
    if (!result.success || !result.ref) {
      printError(result.error || 'Failed to resolve @last');
      return;
    }
    if (result.ref.kind !== 'rpc' || !result.ref.rpc) {
      printError('@last did not resolve to an RPC call');
      printInfo('Only RPC references can be inscribed. Use: show @rpc:<id> to locate an RPC');
      return;
    }
    rpcId = result.ref.rpc;
    sessionId = result.ref.session;
    connectorId = result.ref.connector;
  } else if (parsed.type === 'rpc' && parsed.id) {
    rpcId = parsed.id;
    sessionId = context.session;
    connectorId = context.connector;
  } else if (parsed.type === 'ref' && parsed.id) {
    const result = resolver.resolveUserRef(parsed.id);
    if (!result.success || !result.ref) {
      printError(result.error || `Failed to resolve @ref:${parsed.id}`);
      return;
    }
    if (result.ref.kind !== 'rpc' || !result.ref.rpc) {
      printError(`Reference @ref:${parsed.id} is not an RPC reference`);
      printInfo('Only RPC references can be inscribed.');
      return;
    }
    rpcId = result.ref.rpc;
    sessionId = result.ref.session;
    connectorId = result.ref.connector;
  } else if (parsed.type === 'session') {
    printError('Cannot inscribe a session directly');
    printInfo('Only RPC references can be inscribed. Hint: use show to locate an RPC, then inscribe @rpc:<id>');
    return;
  } else {
    printError(`Cannot inscribe from reference: ${refString}`);
    printInfo('Supported: @last, @rpc:<id>, @ref:<name>');
    return;
  }

  // Get RPC data
  const rpcData = eventsStore.getRpcWithEvents(rpcId!, sessionId);
  if (!rpcData) {
    printError(`RPC not found: ${rpcId}`);
    return;
  }

  // Build ref structure
  const ref: RefStruct = {
    kind: 'rpc',
    connector: connectorId,
    session: rpcData.rpc.session_id,
    rpc: rpcId,
    proto: context.proto || 'mcp',
    captured_at: rpcData.rpc.request_ts,
  };

  // Build payload
  const { payload, redactedCount } = buildPayload(ref, rpcData);

  console.log();
  printInfo(`Inscribing: ${rpcData.rpc.method}`);
  printInfo(`RPC: ${rpcId!.slice(0, 8)}`);
  if (redactedCount > 0) {
    printInfo(`Secrets redacted: ${redactedCount}`);
  }

  if (isDryRun) {
    console.log();
    printInfo('Dry run - payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Send to inscriber
  await sendToInscriber(payload, configPath, eventsStore, isJson);
}

/**
 * Handle inscribe from stdin JSON
 */
async function handleInscribeFromStdin(
  stdinJson: string,
  configPath: string,
  isJson: boolean,
  isDryRun: boolean
): Promise<void> {
  const result = buildPayloadFromStdin(stdinJson);

  if ('error' in result) {
    printError(result.error);
    return;
  }

  const { payload, redactedCount } = result;

  console.log();
  printInfo(`Inscribing: ${payload.rpc.method}`);
  if (payload.ref.rpc) {
    printInfo(`RPC: ${payload.ref.rpc.slice(0, 8)}`);
  }
  if (redactedCount > 0) {
    printInfo(`Secrets redacted: ${redactedCount}`);
  }

  if (isDryRun) {
    console.log();
    printInfo('Dry run - payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const manager = new ConfigManager(configPath);
  const eventsStore = new EventsStore(manager.getConfigDir());

  await sendToInscriber(payload, configPath, eventsStore, isJson);
}

/**
 * Send payload to inscriber connector
 */
async function sendToInscriber(
  payload: InscribePayload,
  configPath: string,
  eventsStore: EventsStore,
  isJson: boolean
): Promise<void> {
  const manager = new ConfigManager(configPath);
  const config = await manager.load();

  // Get inscriber config
  const inscriberConfig: InscriberConfig = config.inscriber || {};
  const inscriberConnectorId = inscriberConfig.connectorId || DEFAULT_INSCRIBER_CONNECTOR;
  const inscriberToolName = inscriberConfig.toolName || DEFAULT_INSCRIBER_TOOL;
  const inscriptionType = inscriberConfig.type || DEFAULT_INSCRIPTION_TYPE;

  // Get inscriber connector
  const connector = await getConnector(configPath, inscriberConnectorId);
  if (!connector) {
    printError(`Inscriber connector not found: ${inscriberConnectorId}`);
    printInfo('Configure inscriber in config.yaml:');
    printInfo('  inscriber:');
    printInfo('    connectorId: inscribe');
    printInfo('Or add a connector with id "inscribe"');
    return;
  }

  if (!connector.enabled) {
    printError(`Inscriber connector is disabled: ${inscriberConnectorId}`);
    printInfo(`Enable it with: pfscan connectors enable --id ${inscriberConnectorId}`);
    return;
  }

  const ctx: ToolContext = {
    connectorId: inscriberConnectorId,
    configDir: manager.getConfigDir(),
  };

  // Check if tool exists
  printInfo('Connecting to inscriber...');
  const toolsResult = await listTools(ctx, connector, { timeout: 30 });

  if (toolsResult.error) {
    printError(`Failed to connect to inscriber: ${toolsResult.error}`);
    return;
  }

  const tool = toolsResult.tools.find(t => t.name === inscriberToolName);
  if (!tool) {
    printError(`Tool not found on inscriber: ${inscriberToolName}`);
    if (toolsResult.tools.length > 0) {
      printInfo('Available tools:');
      for (const t of toolsResult.tools) {
        printInfo(`  ${t.name}`);
      }
    }
    return;
  }

  // Call inscribe tool
  printInfo('Inscribing...');

  // Record outgoing event
  const outEvent = eventsStore.saveEvent(toolsResult.sessionId, 'client_to_server', 'request', {
    summary: `inscribe: ${payload.rpc.method}`,
    rawJson: JSON.stringify({
      tool: inscriberToolName,
      args: {
        content: '<payload>',
        type: inscriptionType,
      },
    }),
  });

  const callResult = await callTool(ctx, connector, inscriberToolName, {
    content: JSON.stringify(payload),
    type: inscriptionType,
  });

  if (!callResult.success) {
    printError(`Inscription failed: ${callResult.error}`);

    // Record error response
    eventsStore.saveEvent(callResult.sessionId, 'server_to_client', 'response', {
      summary: `inscribe error: ${callResult.error}`,
      rawJson: JSON.stringify({ error: callResult.error }),
    });
    return;
  }

  // Parse receipt
  const { receipt, raw } = parseReceipt(callResult.content || []);

  // Record success response
  eventsStore.saveEvent(callResult.sessionId, 'server_to_client', 'response', {
    summary: `inscribe ${receipt.success ? 'success' : 'failed'}${receipt.inscription_id ? `: ${receipt.inscription_id}` : ''}`,
    rawJson: JSON.stringify(receipt),
  });

  // Display result
  console.log();
  if (receipt.success) {
    printSuccess('Inscription successful!');
  } else {
    printError('Inscription returned non-success status');
  }

  if (isJson) {
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    const isTTY = process.stdout.isTTY;
    if (receipt.inscription_id) {
      console.log(`${dimText('Inscription ID:', isTTY)} ${receipt.inscription_id}`);
    }
    if (receipt.verify_url) {
      console.log(`${dimText('Verify URL:', isTTY)} ${receipt.verify_url}`);
    }
    if (raw) {
      console.log(`${dimText('Raw response:', isTTY)} ${raw}`);
    }

    // Show other fields
    for (const [key, value] of Object.entries(receipt)) {
      if (!['success', 'inscription_id', 'verify_url'].includes(key)) {
        console.log(`${dimText(key + ':', isTTY)} ${JSON.stringify(value)}`);
      }
    }
  }

  console.log();
  printInfo(`Session: ${callResult.sessionId.slice(0, 8)}`);
}
