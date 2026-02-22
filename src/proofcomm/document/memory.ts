/**
 * ProofComm Document Memory Management
 * Phase 9.0: Memory management for resident documents
 *
 * This module handles:
 * - Storing conversation summaries
 * - Managing extracted facts
 * - Tracking interaction history
 * - Memory persistence through DocumentsStore
 */

import type { DocumentsStore, DocumentMemory } from '../../db/documents-store.js';
import type { DocumentMemoryState, DocumentMessage } from './types.js';
import { extractText } from './types.js';

/**
 * Maximum number of facts to store
 */
const MAX_FACTS = 100;

/**
 * Maximum conversation summary length
 */
const MAX_SUMMARY_LENGTH = 2000;

/**
 * Document memory manager
 */
export class DocumentMemoryManager {
  constructor(private readonly store: DocumentsStore) {}

  /**
   * Get memory state for a document
   */
  getMemory(docId: string): DocumentMemoryState | undefined {
    const doc = this.store.get(docId);
    if (!doc) return undefined;

    return doc.memory as DocumentMemoryState | undefined;
  }

  /**
   * Update memory after an interaction (atomic operation)
   * Uses transformMemory to prevent race conditions when concurrent
   * messages are processed for the same document.
   */
  updateMemory(
    docId: string,
    message: DocumentMessage,
    responseText: string
  ): DocumentMemoryState | undefined {
    // Extract message text before transaction (pure computation)
    const messageText = extractText(message.parts);

    const result = this.store.transformMemory(docId, (current) => {
      const currentMemory = (current || {}) as DocumentMemoryState;

      // Update interaction count
      const interactionCount = (currentMemory.interactionCount || 0) + 1;

      // Update last interaction time
      const lastInteractionAt = new Date().toISOString();

      // Update conversation summary (simple append for now)
      const summaryPart = `[${interactionCount}] Q: ${truncate(messageText, 100)} A: ${truncate(responseText, 100)}`;
      const conversationSummary = appendToSummary(
        currentMemory.conversationSummary || '',
        summaryPart,
        MAX_SUMMARY_LENGTH
      );

      return {
        ...currentMemory,
        conversationSummary,
        interactionCount,
        lastInteractionAt,
      };
    });

    return result.success ? result.memory as DocumentMemoryState : undefined;
  }

  /**
   * Add a fact to document memory (atomic operation)
   * Uses transformMemory to prevent race conditions when multiple callers
   * add facts concurrently.
   *
   * @returns false if duplicate, doc not found, or error; true if fact was added
   */
  addFact(docId: string, fact: string): boolean {
    const result = this.store.transformMemory(docId, (current) => {
      const facts = current?.facts || [];

      // Check for duplicates - return null to skip update
      if (facts.includes(fact)) {
        return null;
      }

      // Add fact (FIFO if at max)
      const newFacts = [...facts, fact];
      if (newFacts.length > MAX_FACTS) {
        newFacts.shift();
      }

      return {
        ...current,
        facts: newFacts,
      };
    });

    return result.changed;
  }

  /**
   * Remove a fact from document memory (atomic operation)
   *
   * @returns false if fact not found, doc not found, or error; true if fact was removed
   */
  removeFact(docId: string, fact: string): boolean {
    const result = this.store.transformMemory(docId, (current) => {
      const facts = current?.facts || [];

      const index = facts.indexOf(fact);
      if (index === -1) {
        return null; // Fact not found, skip update
      }

      const newFacts = [...facts];
      newFacts.splice(index, 1);

      return {
        ...current,
        facts: newFacts,
      };
    });

    return result.changed;
  }

  /**
   * Clear all facts from document memory (atomic operation)
   */
  clearFacts(docId: string): boolean {
    const result = this.store.transformMemory(docId, (current) => ({
      ...current,
      facts: [],
    }));

    return result.success;
  }

  /**
   * Clear conversation summary (atomic operation)
   */
  clearSummary(docId: string): boolean {
    const result = this.store.transformMemory(docId, (current) => ({
      ...current,
      conversationSummary: '',
    }));

    return result.success;
  }

  /**
   * Clear all memory for a document
   */
  clearMemory(docId: string): boolean {
    return this.store.setMemory(docId, null);
  }

  /**
   * Get memory summary (for debugging/inspection)
   */
  getMemorySummary(docId: string): {
    hasMemory: boolean;
    factCount: number;
    summaryLength: number;
    interactionCount: number;
    lastInteractionAt?: string;
  } {
    const memory = this.getMemory(docId);

    return {
      hasMemory: !!memory,
      factCount: memory?.facts?.length || 0,
      summaryLength: memory?.conversationSummary?.length || 0,
      interactionCount: memory?.interactionCount || 0,
      lastInteractionAt: memory?.lastInteractionAt,
    };
  }
}

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Append to summary with max length
 */
function appendToSummary(
  currentSummary: string,
  newPart: string,
  maxLength: number
): string {
  const separator = currentSummary ? '\n' : '';
  const combined = currentSummary + separator + newPart;

  if (combined.length <= maxLength) {
    return combined;
  }

  // Trim from the beginning to fit
  const overflow = combined.length - maxLength;
  const trimmed = combined.slice(overflow);

  // Find first newline to start at a clean boundary
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline !== -1 && firstNewline < trimmed.length / 2) {
    return trimmed.slice(firstNewline + 1);
  }

  return trimmed;
}
