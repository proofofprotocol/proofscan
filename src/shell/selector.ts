/**
 * Interactive selector for missing arguments
 */

import * as readline from 'readline';
import { supportsColor, printInfo, printError } from './prompt.js';

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reverse: '\x1b[7m',
};

/**
 * Check if interactive selection is available
 */
export function canInteract(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Show a simple numbered list and get selection
 */
export async function selectFromList(
  items: string[],
  prompt: string
): Promise<string | null> {
  if (!canInteract()) {
    return null;
  }

  if (items.length === 0) {
    printError('No items available to select');
    return null;
  }

  // Show numbered list
  console.log();
  printInfo(prompt);
  console.log();

  const useColors = supportsColor();
  items.forEach((item, index) => {
    const num = `[${index + 1}]`;
    if (useColors) {
      console.log(`  ${COLORS.cyan}${num}${COLORS.reset} ${item}`);
    } else {
      console.log(`  ${num} ${item}`);
    }
  });

  console.log();

  // Get user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter number (or q to cancel): ', (answer) => {
      rl.close();

      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'q' || trimmed === '') {
        resolve(null);
        return;
      }

      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 1 || num > items.length) {
        printError(`Invalid selection: ${trimmed}`);
        resolve(null);
        return;
      }

      resolve(items[num - 1]);
    });
  });
}

/**
 * Show connector selection UI
 */
export async function selectConnector(connectors: string[]): Promise<string | null> {
  return selectFromList(connectors, 'Select a connector:');
}

/**
 * Show session selection UI
 */
export async function selectSession(sessions: Array<{ id: string; connector_id: string }>): Promise<string | null> {
  const items = sessions.map(s => `${s.id.slice(0, 8)} (${s.connector_id})`);
  const selected = await selectFromList(items, 'Select a session:');

  if (!selected) {
    return null;
  }

  // Extract session ID from selection
  const match = selected.match(/^([a-f0-9]+)/);
  return match ? sessions.find(s => s.id.startsWith(match[1]))?.id || null : null;
}
