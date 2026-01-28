/**
 * A2A Session Manager
 *
 * Manages A2A session recording in EventLineDB.
 * Creates and tracks sessions for A2A conversations.
 */

import { randomUUID } from 'crypto';
import type { A2AMessage, A2ATask } from './types.js';
import type { EventsStore } from '../db/events-store.js';

export interface A2ASessionRecord {
  sessionId: string;
  contextId: string | null;
  targetId: string;
  messages: A2AMessageRecord[];
}

export interface A2AMessageRecord {
  id: string; // messageId or generated ID
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Session manager for A2A conversations
 */
export class A2ASessionManager {
  private eventsStore: EventsStore;
  private targetId: string;
  private currentSessionId: string | null = null;
  private currentContextId: string | null = null;

  constructor(eventsStore: EventsStore, targetId: string) {
    this.eventsStore = eventsStore;
    this.targetId = targetId;
  }

  /**
   * Get or create a session for the given contextId
   *
   * @param contextId - A2A context ID (conversation ID from task/message)
   * @returns Session ID
   */
  getOrCreateSession(contextId?: string): string {
    // If same contextId and session exists, reuse it
    if (contextId && this.currentContextId === contextId && this.currentSessionId) {
      return this.currentSessionId;
    }

    // If new contextId, try to find existing session by contextId
    if (contextId) {
      const existingSession = this.findSessionByContextId(contextId, this.targetId);
      if (existingSession) {
        this.currentSessionId = existingSession;
        this.currentContextId = contextId;
        return this.currentSessionId;
      }
    }

    // Create new session
    const session = this.eventsStore.createSession(this.targetId, {
      actorId: this.targetId,
      actorKind: 'agent',
      actorLabel: this.targetId,
    });

    this.currentSessionId = session.session_id;
    this.currentContextId = contextId || null;

    return this.currentSessionId;
  }

  /**
   * Record an A2A message (send or receive)
   *
   * @param contextId - A2A context ID
   * @param message - A2A message
   * @param isRequest - True for sent (request), false for received (response)
   * @param rpcId - Optional RPC ID for request/response pairing
   */
  recordMessage(
    contextId: string | undefined,
    message: A2AMessage,
    isRequest: boolean,
    rpcId?: string
  ): void {
    const sessionId = this.getOrCreateSession(contextId);

    const messageId = message.messageId || randomUUID();
    const content = this.extractTextContent(message);

    // Record RPC call for A2A message
    if (isRequest && rpcId) {
      this.eventsStore.saveRpcCall(sessionId, rpcId, 'message/send');
    }

    // For response messages, wrap in JSON-RPC result format for normalization
    // This allows normalizeA2aEvent to process it correctly
    const rawJson = isRequest
      ? JSON.stringify(message)
      : JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: message });

    // Record event
    this.eventsStore.saveEvent(
      sessionId,
      isRequest ? 'client_to_server' : 'server_to_client',
      isRequest ? 'request' : 'response',
      {
        rpcId,
        rawJson,
        summary: this.createSummary(message, isRequest),
        protocol: 'a2a',
      }
    );

    // Complete RPC if this is a response
    if (!isRequest && rpcId) {
      this.eventsStore.completeRpcCall(sessionId, rpcId, true);
    }
  }

  /**
   * Record an A2A task response
   *
   * @param contextId - A2A context ID
   * @param task - A2A task
   * @param rpcId - RPC ID for request/response pairing
   */
  recordTask(
    contextId: string | undefined,
    task: A2ATask,
    rpcId?: string
  ): void {
    const sessionId = this.getOrCreateSession(contextId);

    // Record all messages in the task
    for (const message of task.messages) {
      const isUserMessage = message.role === 'user';
      const msgRpcId = isUserMessage ? undefined : rpcId; // Only record assistant messages as response

      this.recordMessage(contextId, message, false, msgRpcId);
    }
  }

  /**
   * Record an error during A2A communication
   *
   * @param contextId - A2A context ID
   * @param rpcId - RPC ID
   * @param errorMessage - Error message
   */
  recordError(
    contextId: string | undefined,
    rpcId: string,
    errorMessage: string
  ): void {
    const sessionId = this.getOrCreateSession(contextId);

    this.eventsStore.completeRpcCall(sessionId, rpcId, false, 500);
  }

  /**
   * Find an existing session by contextId
   */
  private findSessionByContextId(contextId: string, targetId: string): string | null {
    // Look for a session with the same contextId in user_refs
    // For now, we'll just check if we have a session with this target
    // In the future, we could store contextId mapping in user_refs or add it to sessions table

    // For simplicity, just return null (always create new session per contextId)
    // TODO: Implement contextId persistence in sessions table
    return null;
  }

  /**
   * Extract text content from an A2A message
   */
  private extractTextContent(message: A2AMessage): string {
    if (!message.parts || !Array.isArray(message.parts)) {
      return '';
    }

    return message.parts
      .filter((p): p is { text: string } => 'text' in p && typeof p.text === 'string')
      .map(p => p.text)
      .join('');
  }

  /**
   * Create a summary for display in event list
   */
  private createSummary(message: A2AMessage, isRequest: boolean): string {
    const role = message.role === 'assistant' ? '🤖' : '👤';
    const content = this.extractTextContent(message);
    const truncated = content.length > 50 ? content.slice(0, 50) + '...' : content;

    return `${role} ${isRequest ? '→' : '←'} ${truncated}`;
  }
}

/**
 * Create a session manager for an A2A agent
 */
export function createA2ASessionManager(
  eventsStore: EventsStore,
  targetId: string
): A2ASessionManager {
  return new A2ASessionManager(eventsStore, targetId);
}
