/**
 * ProofComm Document Responder
 * Phase 9.0: Response generation for resident documents
 *
 * This module handles:
 * - Processing incoming messages to documents
 * - Generating responses based on document content
 * - Memory integration for contextual responses
 * - A2A message format conversion
 *
 * Note: This is a basic responder that returns document content excerpts.
 * Future versions may integrate with LLM for intelligent responses.
 */

import type { DocumentsStore } from '../../db/documents-store.js';
import type {
  DocumentContext,
  DocumentMessage,
  DocumentResponse,
  DocumentMemoryState,
} from './types.js';
import { extractText } from './types.js';
import { readDocument, hasDocumentChanged } from './store.js';
import { DocumentMemoryManager } from './memory.js';

/**
 * Response generation options
 */
export interface ResponderOptions {
  /** Maximum response length */
  maxResponseLength?: number;
  /** Include memory context */
  includeMemory?: boolean;
  /** Update memory after response */
  updateMemory?: boolean;
  /**
   * Automatically update document hash when content changes.
   * When enabled, if the document content has changed since last read,
   * the stored hash will be updated as a side effect.
   * Default: true
   */
  autoUpdateHash?: boolean;
}

const DEFAULT_MAX_RESPONSE_LENGTH = 4000;

/**
 * Document responder class
 */
export class DocumentResponder {
  private memoryManager: DocumentMemoryManager;

  constructor(private readonly store: DocumentsStore) {
    this.memoryManager = new DocumentMemoryManager(store);
  }

  /**
   * Process a message and generate a response
   */
  async processMessage(
    docId: string,
    message: DocumentMessage,
    options?: ResponderOptions
  ): Promise<DocumentResponse> {
    const maxLength = options?.maxResponseLength ?? DEFAULT_MAX_RESPONSE_LENGTH;
    const includeMemory = options?.includeMemory ?? true;
    const updateMemory = options?.updateMemory ?? true;
    const autoUpdateHash = options?.autoUpdateHash ?? true;

    // Get document from store
    const doc = this.store.get(docId);
    if (!doc) {
      return this.createErrorResponse(`Document not found: ${docId}`);
    }

    // Read document content
    let context: DocumentContext;
    try {
      const content = await readDocument(doc.documentPath);

      // Check if hash changed and update if needed (side effect controlled by option)
      if (autoUpdateHash && doc.documentHash && content.hash !== doc.documentHash) {
        this.store.updateHash(docId, content.hash);
      }

      context = {
        docId,
        name: doc.name,
        content,
        memory: includeMemory ? this.memoryManager.getMemory(docId) : undefined,
      };
    } catch (err) {
      return this.createErrorResponse(
        `Failed to read document: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Extract message text
    const messageText = extractText(message.parts);

    // Generate response based on message and context
    const responseText = this.generateResponse(messageText, context, maxLength);

    // Update memory if enabled
    let updatedMemory: DocumentMemoryState | undefined;
    if (updateMemory) {
      updatedMemory = this.memoryManager.updateMemory(docId, message, responseText);
    }

    return {
      parts: [{ text: responseText }],
      memoryUpdated: updateMemory,
      updatedMemory,
    };
  }

  /**
   * Generate a response based on message and context
   *
   * This is a simple keyword-based responder.
   * Future versions may use LLM integration.
   */
  private generateResponse(
    messageText: string,
    context: DocumentContext,
    maxLength: number
  ): string {
    const { content, name, memory } = context;
    const docContent = content.text;

    // Normalize for search
    const lowerMessage = messageText.toLowerCase().trim();

    // Check for special commands
    if (lowerMessage === 'content' || lowerMessage === 'show content') {
      return this.truncateResponse(
        `Here is the content of "${name}":\n\n${docContent}`,
        maxLength
      );
    }

    if (lowerMessage === 'summary' || lowerMessage === 'summarize') {
      return this.generateSummary(docContent, name, maxLength);
    }

    if (lowerMessage === 'memory' || lowerMessage === 'show memory') {
      return this.formatMemory(memory, name);
    }

    if (lowerMessage === 'info' || lowerMessage === 'status') {
      return this.formatInfo(context);
    }

    // Search for relevant content
    const relevantExcerpt = this.findRelevantExcerpt(messageText, docContent, maxLength);
    if (relevantExcerpt) {
      return `Based on "${name}":\n\n${relevantExcerpt}`;
    }

    // Default response with document intro
    const intro = this.getDocumentIntro(docContent, maxLength);
    return `I am the document "${name}". ${intro}\n\nAsk me about specific topics or use "content" to see my full content.`;
  }

  /**
   * Find a relevant excerpt from document content based on keywords
   */
  private findRelevantExcerpt(
    query: string,
    content: string,
    maxLength: number
  ): string | null {
    // Extract keywords (words > 3 chars, not common words)
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
      'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'this',
      'that', 'with', 'they', 'what', 'from', 'will', 'would', 'there',
      'their', 'which', 'about', 'could', 'these', 'other', 'into', 'than',
      'then', 'some', 'when', 'more', 'very', 'after', 'just', 'where',
    ]);

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    if (keywords.length === 0) return null;

    // Find best matching paragraph
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
    let bestMatch: { paragraph: string; score: number } | null = null;

    for (const para of paragraphs) {
      const lowerPara = para.toLowerCase();
      let score = 0;

      for (const keyword of keywords) {
        if (lowerPara.includes(keyword)) {
          score += 1;
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { paragraph: para, score };
      }
    }

    if (!bestMatch) return null;

    return this.truncateResponse(bestMatch.paragraph.trim(), maxLength - 50);
  }

  /**
   * Generate a summary of document content
   */
  private generateSummary(content: string, name: string, maxLength: number): string {
    // Simple summary: first paragraph or first N lines
    const lines = content.split('\n').filter(l => l.trim().length > 0);

    if (lines.length === 0) {
      return `The document "${name}" is empty.`;
    }

    // Take first few lines as summary
    let summary = '';
    for (const line of lines) {
      if (summary.length + line.length + 1 > maxLength - 100) break;
      summary += (summary ? '\n' : '') + line;
    }

    return `Summary of "${name}":\n\n${summary}`;
  }

  /**
   * Format memory state for display
   */
  private formatMemory(memory: DocumentMemoryState | undefined, name: string): string {
    if (!memory) {
      return `No conversation memory for "${name}" yet.`;
    }

    const parts: string[] = [`Memory for "${name}":`];

    if (memory.interactionCount) {
      parts.push(`\nInteractions: ${memory.interactionCount}`);
    }

    if (memory.lastInteractionAt) {
      parts.push(`Last interaction: ${memory.lastInteractionAt}`);
    }

    if (memory.facts && memory.facts.length > 0) {
      parts.push(`\nFacts (${memory.facts.length}):`);
      for (const fact of memory.facts.slice(0, 10)) {
        parts.push(`  - ${fact}`);
      }
      if (memory.facts.length > 10) {
        parts.push(`  ... and ${memory.facts.length - 10} more`);
      }
    }

    if (memory.conversationSummary) {
      const summaryPreview = memory.conversationSummary.slice(0, 500);
      parts.push(`\nConversation summary:\n${summaryPreview}`);
      if (memory.conversationSummary.length > 500) {
        parts.push('...');
      }
    }

    return parts.join('\n');
  }

  /**
   * Format document info for display
   */
  private formatInfo(context: DocumentContext): string {
    const { docId, name, content, memory } = context;

    const parts: string[] = [
      `Document: ${name}`,
      `ID: ${docId}`,
      `Size: ${content.size} bytes`,
      `Hash: ${content.hash.slice(0, 16)}...`,
      `MIME type: ${content.mimeType || 'unknown'}`,
      `Modified: ${content.modifiedAt}`,
    ];

    if (memory) {
      parts.push(`\nMemory:`);
      parts.push(`  Interactions: ${memory.interactionCount || 0}`);
      parts.push(`  Facts: ${memory.facts?.length || 0}`);
    }

    return parts.join('\n');
  }

  /**
   * Get document intro (first paragraph or lines)
   */
  private getDocumentIntro(content: string, maxLength: number): string {
    const firstPara = content.split(/\n\n/)[0] || '';
    return this.truncateResponse(firstPara.trim(), Math.min(200, maxLength / 2));
  }

  /**
   * Truncate response to max length
   */
  private truncateResponse(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }

  /**
   * Create error response
   */
  private createErrorResponse(error: string): DocumentResponse {
    return {
      parts: [{ text: `Error: ${error}` }],
      memoryUpdated: false,
    };
  }

  /**
   * Check if document content has changed
   *
   * @returns true if changed, false if unchanged
   * @throws Error if document not found or file cannot be read
   */
  async hasContentChanged(docId: string): Promise<boolean> {
    const doc = this.store.get(docId);
    if (!doc) {
      throw new Error(`Document not found: ${docId}`);
    }
    if (!doc.documentHash) {
      // No previous hash, consider it changed
      return true;
    }

    // Let errors propagate - caller handles read failures
    return hasDocumentChanged(doc.documentPath, doc.documentHash);
  }

  /**
   * Refresh document hash (call when file changes)
   */
  async refreshHash(docId: string): Promise<string | null> {
    const doc = this.store.get(docId);
    if (!doc) return null;

    try {
      const content = await readDocument(doc.documentPath);
      this.store.updateHash(docId, content.hash);
      return content.hash;
    } catch {
      return null;
    }
  }
}
