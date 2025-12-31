/**
 * Shell module exports
 */

export { ShellRepl, isValidArg } from './repl.js';
export { generatePrompt, supportsColor } from './prompt.js';
export { getHistoryPath, loadHistory, saveHistory } from './history.js';
export { createCompleter, getCompletions, type DynamicDataProvider } from './completer.js';
export { selectConnector, selectSession, canInteract } from './selector.js';
export type { ShellContext, CompletionResult, ProtoType } from './types.js';
export { TOP_LEVEL_COMMANDS, COMMAND_SUBCOMMANDS, SHELL_BUILTINS, ROUTER_COMMANDS } from './types.js';
export { applyContext } from './context-applicator.js';
export {
  handleCc,
  handleUp,
  handlePwd,
  handleLs,
  handleShow,
  detectProto,
  detectConnectorProto,
  getContextLevel,
} from './router-commands.js';
