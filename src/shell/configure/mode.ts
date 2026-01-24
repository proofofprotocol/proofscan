/**
 * Configure Mode Manager
 *
 * Manages the configure mode state and transitions.
 * Handles entering/exiting configure mode and managing edit sessions.
 */

import type { Connector } from '../../types/config.js';
import type { ConfigureModeState, EditSession, CommitResult } from './types.js';
import { cloneConnector, createEmptyConnector } from './types.js';
import { EditSessionManager } from './session.js';
import { ConfigManager } from '../../config/index.js';
import { IpcClient } from '../../proxy/ipc-client.js';
import { getSocketPath } from '../../proxy/ipc-types.js';

/**
 * ConfigureMode manages the state of configure terminal mode
 */
export class ConfigureMode {
  private state: ConfigureModeState = {
    active: false,
    editSession: null,
  };

  private configManager: ConfigManager;
  private sessionManager: EditSessionManager | null = null;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  /**
   * Enter configure mode
   */
  enter(): void {
    this.state.active = true;
  }

  /**
   * Exit configure mode
   * @returns true if exit was successful, false if blocked (dirty state)
   */
  exit(): { canExit: boolean; isDirty: boolean } {
    if (this.sessionManager && this.sessionManager.isDirty()) {
      return { canExit: false, isDirty: true };
    }

    this.state.active = false;
    this.state.editSession = null;
    this.sessionManager = null;

    return { canExit: true, isDirty: false };
  }

  /**
   * Force exit configure mode (discard any changes)
   */
  forceExit(): void {
    this.state.active = false;
    this.state.editSession = null;
    this.sessionManager = null;
  }

  /**
   * Start editing a connector
   * @param id - Connector ID to edit (creates new if not found)
   */
  async editConnector(id: string): Promise<{ isNew: boolean; connector: Connector }> {
    const config = await this.configManager.load();
    const existing = config.connectors.find((c: Connector) => c.id === id);

    let session: EditSession;
    let isNew = false;

    if (existing) {
      // Edit existing connector
      session = {
        original: cloneConnector(existing),
        candidate: cloneConnector(existing),
        modifiedFields: new Set(),
        pendingSecrets: new Map(),
        isNew: false,
      };
    } else {
      // Create new connector
      const newConnector = createEmptyConnector(id);
      session = {
        original: newConnector,
        candidate: cloneConnector(newConnector),
        modifiedFields: new Set(),
        pendingSecrets: new Map(),
        isNew: true,
      };
      isNew = true;
    }

    this.state.editSession = session;
    this.sessionManager = new EditSessionManager(session);

    return { isNew, connector: session.candidate };
  }

  /**
   * End the current edit session without committing
   */
  endEditSession(): { wasDirty: boolean } {
    const wasDirty = this.sessionManager?.isDirty() ?? false;
    this.state.editSession = null;
    this.sessionManager = null;
    return { wasDirty };
  }

  /**
   * Check if configure mode is active
   */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * Check if currently editing a connector
   */
  isEditing(): boolean {
    return this.state.editSession !== null;
  }

  /**
   * Check if the current session has uncommitted changes
   */
  isDirty(): boolean {
    return this.sessionManager?.isDirty() ?? false;
  }

  /**
   * Get the current edit session
   */
  getSession(): EditSession | null {
    return this.state.editSession;
  }

  /**
   * Get the session manager for the current session
   */
  getSessionManager(): EditSessionManager | null {
    return this.sessionManager;
  }

  /**
   * Get the current connector being edited
   */
  getCurrentConnector(): Connector | null {
    return this.state.editSession?.candidate ?? null;
  }

  /**
   * List all connectors from the committed configuration (running-config).
   * This loads the saved state from disk, not any pending edits in the current session.
   */
  async listConnectors(): Promise<Connector[]> {
    const config = await this.configManager.load();
    return config.connectors;
  }

  /**
   * Get the prompt string for the current state
   */
  getPrompt(): string {
    if (!this.state.active) {
      return 'proofscan:/ > ';
    }

    if (!this.state.editSession) {
      return 'proofscan(config)# ';
    }

    const connectorId = this.state.editSession.candidate.id;
    const dirty = this.sessionManager?.isDirty() ? '*' : '';

    return `proofscan(config-conn:${connectorId})${dirty}# `;
  }

  /**
   * Commit the current edit session
   *
   * Commit types:
   * - 'added': New connector created and saved to config
   * - 'updated': Existing connector modified and saved
   * - 'none': No changes (existing connector with no modifications)
   */
  async commit(options: {
    dryRun?: boolean;
    noReload?: boolean;
  } = {}): Promise<CommitResult> {
    if (!this.state.editSession || !this.sessionManager) {
      return {
        success: false,
        proxyReloaded: false,
        secretsStored: 0,
        error: 'No active edit session',
        commitType: 'none',
      };
    }

    const session = this.state.editSession;
    const diff = this.sessionManager.getDiff();
    const hasFieldChanges = this.sessionManager.hasFieldChanges();

    // Determine commit type
    // - New connector: always 'added' (even if no field changes, the connector itself is new)
    // - Existing connector with changes: 'updated'
    // - Existing connector without changes: 'none'
    let commitType: 'added' | 'updated' | 'none';
    if (session.isNew) {
      commitType = 'added';
    } else if (diff.hasChanges || hasFieldChanges) {
      commitType = 'updated';
    } else {
      commitType = 'none';
    }

    // No changes case: existing connector with no modifications
    if (commitType === 'none') {
      // Clear the edit session without writing
      this.state.editSession = null;
      this.sessionManager = null;

      return {
        success: true,
        proxyReloaded: false,
        secretsStored: 0,
        commitType: 'none',
      };
    }

    if (options.dryRun) {
      return {
        success: true,
        proxyReloaded: false,
        secretsStored: 0,
        message: 'Dry run - no changes applied',
        diff,
        commitType,
      };
    }

    try {
      // Finalize secrets (store to SQLite and replace with references)
      const configDir = this.configManager.getConfigDir();
      const secretsCount = session.pendingSecrets.size;
      const finalizedConnector = await this.sessionManager.finalizeSecrets(configDir);

      // Add or update the connector in config based on commit type
      if (commitType === 'added') {
        await this.configManager.addConnector(finalizedConnector);
      } else {
        // commitType === 'updated'
        await this.configManager.updateConnector(session.original.id, finalizedConnector);
      }

      // Reload proxy if not disabled and there were actual changes
      let proxyReloaded = false;
      let proxyMessage: string | undefined;

      if (!options.noReload) {
        const socketPath = getSocketPath(configDir);
        const ipcClient = new IpcClient(socketPath);

        const isRunning = await ipcClient.isRunning();
        if (isRunning) {
          const reloadResult = await ipcClient.reload();
          if (reloadResult.success) {
            proxyReloaded = true;
          } else {
            proxyMessage = `Proxy reload failed: ${reloadResult.error}`;
          }
        } else {
          proxyMessage = 'Proxy not running (reload skipped)';
        }
      }

      // Clear the edit session
      this.state.editSession = null;
      this.sessionManager = null;

      return {
        success: true,
        proxyReloaded,
        secretsStored: secretsCount,
        message: proxyMessage,
        diff,
        commitType,
      };
    } catch (error) {
      return {
        success: false,
        proxyReloaded: false,
        secretsStored: 0,
        error: error instanceof Error ? error.message : String(error),
        commitType,
      };
    }
  }

  /**
   * Discard the current edit session
   */
  discard(): { hadChanges: boolean } {
    const hadChanges = this.sessionManager?.isDirty() ?? false;
    this.state.editSession = null;
    this.sessionManager = null;
    return { hadChanges };
  }
}
