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
   * Update memory after an interaction
   */
  updateMemory(
    docId: string,
    message: DocumentMessage,
    responseText: string
  ): DocumentMemoryState | undefined {
    // Check if document exists
    const doc = this.store.get(docId);
    if (!doc) return undefined;

    const currentMemory = doc.memory as DocumentMemoryState || {};

    // Extract message text
    const messageText = extractText(message.parts);

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

    const updatedMemory: DocumentMemoryState = {
      ...currentMemory,
      conversationSummary,
      interactionCount,
      lastInteractionAt,
    };

    // Persist to database (include all fields)
    const dbMemory: DocumentMemory = {
      conversationSummary: updatedMemory.conversationSummary,
      facts: updatedMemory.facts,
      interactionCount: updatedMemory.interactionCount,
      lastInteractionAt: updatedMemory.lastInteractionAt,
    };

    this.store.updateMemory(docId, dbMemory);

    return updatedMemory;
  }

  /**
   * Add a fact to document memory
   */
  addFact(docId: string, fact: string): boolean {
    const currentMemory = this.getMemory(docId) || {};
    const facts = currentMemory.facts || [];

    // Check for duplicates
    if (facts.includes(fact)) {
      return false;
    }

    // Add fact (FIFO if at max)
    const newFacts = [...facts, fact];
    if (newFacts.length > MAX_FACTS) {
      newFacts.shift();
    }

    const dbMemory: DocumentMemory = {
      conversationSummary: currentMemory.conversationSummary,
      facts: newFacts,
    };

    return this.store.updateMemory(docId, dbMemory);
  }

  /**
   * Remove a fact from document memory
   */
  removeFact(docId: string, fact: string): boolean {
    const currentMemory = this.getMemory(docId) || {};
    const facts = currentMemory.facts || [];

    const index = facts.indexOf(fact);
    if (index === -1) {
      return false;
    }

    const newFacts = [...facts];
    newFacts.splice(index, 1);

    const dbMemory: DocumentMemory = {
      conversationSummary: currentMemory.conversationSummary,
      facts: newFacts,
    };

    return this.store.updateMemory(docId, dbMemory);
  }

  /**
   * Clear all facts from document memory
   */
  clearFacts(docId: string): boolean {
    const currentMemory = this.getMemory(docId) || {};

    const dbMemory: DocumentMemory = {
      conversationSummary: currentMemory.conversationSummary,
      facts: [],
    };

    return this.store.updateMemory(docId, dbMemory);
  }

  /**
   * Clear conversation summary
   */
  clearSummary(docId: string): boolean {
    const currentMemory = this.getMemory(docId) || {};

    const dbMemory: DocumentMemory = {
      conversationSummary: '',
      facts: currentMemory.facts,
    };

    return this.store.updateMemory(docId, dbMemory);
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
