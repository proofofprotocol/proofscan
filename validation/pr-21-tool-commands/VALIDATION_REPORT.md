# PR #21 Validation Report: feat(cli): add `pfscan tool` commands

**PR**: https://github.com/proofofprotocol/proofscan/pull/21  
**Branch**: `feature/cli-tool-commands`  
**Date**: 2026-01-03  
**Reviewer**: AI Assistant (Genspark Validation Lab)  
**Environment**: Genspark Sandbox

---

## Executive Summary

**Overall Status**: ✅ **APPROVE WITH REQUESTED CHANGES**

The implementation successfully adds stateless CLI commands for MCP tool operations (ls, show, call). All three commands work correctly with real MCP servers. The architecture is clean and follows project conventions well.

**Quality Score**: 8/10

### Key Strengths
- ✅ Clean stateless design (1 command = 1 session)
- ✅ Excellent user experience (multiple input methods, dry-run, JSON output)
- ✅ Proper integration with existing codebase
- ✅ Good error handling and observability

### Critical Issues Found
- 🔴 **stdin handling** lacks TTY check and timeout (could hang indefinitely)
- 🔴 **timeout validation** missing (parseInt could produce NaN)
- 🟡 **file path validation** needed for --args-file (security)
- 🟡 **code duplication** in connector validation logic

---

## Functional Testing Results

### Test Environment
- **Node.js**: v20.19.6
- **npm**: 10.8.2
- **MCP Server**: @modelcontextprotocol/server-everything (via npx)
- **Connector ID**: echo

### 1. `pfscan tool ls` - List Tools

**Command**:
```bash
node dist/cli.js tool ls echo --timeout 60
```

**Result**: ✅ **PASS**

**Output**:
```
Tool                  Required  Description
----------------------------------------------------------------------
echo                  1         Echoes back the input
add                   2         Adds two numbers
longRunningOperation  0         Demonstrates a long running operation...
printEnv              0         Prints all environment variables, hel...
sampleLLM             1         Samples from an LLM using MCP's sampl...
getTinyImage          0         Returns the MCP_TINY_IMAGE
annotatedMessage      1         Demonstrates how annotations can be u...
getResourceReference  1         Returns a resource reference that can...
getResourceLinks      0         Returns multiple resource links that ...
structuredContent     1         Returns structured content along with...
zip                   1         Compresses the provided resource file...

Found 11 tool(s)
Session: c1dbe780
```

**Validation**:
- ✅ Successfully connects to MCP server via npx
- ✅ Lists all 11 available tools
- ✅ Shows required argument counts
- ✅ Truncates long descriptions appropriately
- ✅ Provides session ID for traceability
- ✅ Table format is readable and well-aligned

---

### 2. `pfscan tool show` - Show Tool Details

**Command**:
```bash
node dist/cli.js tool show echo echo
```

**Result**: ✅ **PASS**

**Output**:
```
Tool: echo

Description:
  Echoes back the input

Required arguments:
  message (string)
    Message to echo

Session: 552af255
Run with: pfscan tool call echo echo --args '{...}'
```

**Validation**:
- ✅ Shows tool name and description
- ✅ Lists required arguments with types
- ✅ Provides helpful usage example
- ✅ Session tracking works correctly
- ✅ Clear, human-readable format

---

### 3. `pfscan tool call` - Call MCP Tool

**Command**:
```bash
node dist/cli.js tool call echo echo --args '{"message":"Hello from proofscan validation!"}'
```

**Result**: ✅ **PASS**

**Output**:
```
Result:
  Echo: Hello from proofscan validation!

Session: fb9ecccd
View details: pfscan rpc list --session fb9ecccd
```

**Validation**:
- ✅ Successfully calls MCP tool with arguments
- ✅ Returns correct result from tool execution
- ✅ Provides cross-reference to RPC command
- ✅ Session tracking enables detailed inspection

---

### 4. JSON Output Mode

**Command**:
```bash
node dist/cli.js --json tool call echo add --args '{"a":5,"b":3}'
```

**Result**: ✅ **PASS**

**Output**:
```json
{
  "success": true,
  "sessionId": "f5e98c93-941b-471f-8117-00368c9f42ec",
  "content": [
    {
      "type": "text",
      "text": "The sum of 5 and 3 is 8."
    }
  ]
}
```

**Validation**:
- ✅ Valid JSON output
- ✅ Includes success status
- ✅ Provides session ID for traceability
- ✅ Properly formats tool response content
- ✅ Suitable for scripting and CI/CD integration

---

### 5. Dry-Run Mode

**Command**:
```bash
node dist/cli.js tool call echo echo --args '{"message":"test"}' --dry-run
```

**Result**: ✅ **PASS**

**Output**:
```
Dry run - would send:
{
  "connector": "echo",
  "tool": "echo",
  "arguments": {
    "message": "test"
  }
}
```

**Validation**:
- ✅ Does not execute tool call
- ✅ Shows what would be sent
- ✅ Useful for testing and debugging
- ✅ Fast execution (no MCP connection)

---

## Code Review Findings

### Critical Issues (Must Fix Before Merge)

#### 1. stdin Handling Vulnerability (tool.ts:51-64)

**Issue**: No TTY check or timeout for stdin reading

**Risk**: HIGH - Could hang indefinitely if stdin is closed or in interactive mode

**Current Code**:
```typescript
if (options.stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(new Error(`Invalid JSON from stdin: ${e instanceof Error ? e.message : e}`));
      }
    });
    process.stdin.on('error', reject);
  });
}
```

**Recommended Fix**:
```typescript
if (options.stdin) {
  // Check if stdin is piped (not a TTY)
  if (process.stdin.isTTY) {
    throw new Error('--stdin requires piped input (e.g., echo "{}" | pfscan tool call ...)');
  }
  
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => {
      reject(new Error('Timeout reading from stdin (10s)'));
    }, 10000);
    
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (chunk) => { data += chunk; });
    process.stdin.once('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(new Error(`Invalid JSON from stdin: ${e instanceof Error ? e.message : e}`));
      }
    });
    process.stdin.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
```

---

#### 2. Missing Timeout Validation (tool.ts:113, 202, 344)

**Issue**: `parseInt(options.timeout, 10)` doesn't validate the result

**Risk**: MEDIUM - NaN will be passed to adapter functions if non-numeric input

**Current Code**:
```typescript
const result = await listTools(ctx, connector, {
  timeout: parseInt(options.timeout, 10),
});
```

**Recommended Fix**:
```typescript
const timeoutSec = parseInt(options.timeout, 10);
if (isNaN(timeoutSec) || timeoutSec <= 0) {
  console.error('Invalid timeout value. Must be a positive number.');
  process.exit(1);
}

const result = await listTools(ctx, connector, {
  timeout: timeoutSec,
});
```

---

### High Priority Issues

#### 3. File Path Validation for --args-file

**Issue**: No validation to prevent directory traversal

**Risk**: MEDIUM - Security concern for file path injection

**Recommended Fix**:
```typescript
if (options.argsFile) {
  const resolvedPath = path.resolve(options.argsFile);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${options.argsFile}`);
  }
  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error(`Not a file: ${options.argsFile}`);
  }
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  return JSON.parse(content);
}
```

---

#### 4. Code Duplication in Connector Validation

**Issue**: Lines 92-110, 182-194, 298-310 are nearly identical

**Risk**: LOW - Maintainability concern

**Recommendation**: Extract to helper function:
```typescript
async function validateConnector(
  configPath: string,
  connectorId: string
): Promise<{ connector: Connector; configDir: string } | never> {
  const manager = new ConfigManager(configPath);
  const configDir = manager.getConfigDir();
  const connector = await getConnector(configPath, connectorId);

  if (!connector) {
    console.error(`Connector not found: ${connectorId}`);
    process.exit(1);
  }

  if (!connector.enabled) {
    console.error(`Connector is disabled: ${connectorId}`);
    process.exit(1);
  }

  return { connector, configDir };
}
```

---

### Medium Priority Issues

#### 5. Potential Edge Case in truncate() (tool.ts:74-77)

**Issue**: If `maxLen < 3`, slicing could produce unexpected results

**Recommended Fix**:
```typescript
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  if (maxLen < 4) return str.slice(0, maxLen);
  return str.slice(0, maxLen - 3) + '...';
}
```

#### 6. Magic Numbers

**Issue**: Hard-coded values reduce maintainability

**Examples**: 
- Line 139: `12` (minimum tool name width)
- Line 147: `50` (separator length)

**Recommendation**: Extract as named constants

---

## Test Coverage Assessment

### Missing Tests
- ❌ **Critical Gap**: No test file found for `tool.ts` commands
- ❌ No tests for argument resolution (`--args`, `--args-file`, `--stdin`)
- ❌ No tests for dry-run mode
- ❌ No tests for JSON output mode
- ❌ No tests for error cases (connector not found, disabled, timeout)

### Recommendation
Create comprehensive test file: `src/commands/tool.test.ts` covering:
- All three commands (ls, show, call) with mock MCP server
- All input methods for arguments
- Dry-run and JSON output modes
- Error conditions and edge cases

---

## Architecture Review

### Strengths
1. **Stateless Design**: Each command spawns a fresh MCP connection
   - ✅ Predictable behavior
   - ✅ No connection pooling complexity
   - ✅ Clean resource management

2. **Separation of Concerns**: 
   - ✅ Business logic in `tools/adapter.ts`
   - ✅ CLI concerns in `tool.ts`
   - ✅ Proper abstraction layers

3. **Integration**:
   - ✅ Registered in `cli.ts` (line 231)
   - ✅ Added to `KNOWN_COMMANDS` (line 246)
   - ✅ Shell integration via `tool call` alias
   - ✅ Events recorded to database

### Considerations
- Each tool call creates a new session (overhead for batch operations)
- No connection caching (acceptable for CLI, consider for future batch mode)

---

## Security Review

### Good Practices
- ✅ Secret resolution via `resolveEnvSecrets`
- ✅ JSON parsing with error handling
- ✅ Process isolation (separate sessions)

### Concerns
- 🔴 stdin: No TTY check (could hang)
- 🟡 --args-file: No path validation (directory traversal risk)
- ✅ Command injection: Args passed as JSON objects (safe)

---

## Performance Observations

### Connection Times
- **tool ls**: ~6.5 seconds (initialize + tools/list RPC)
- **tool show**: ~6.5 seconds (initialize + tools/list)
- **tool call**: ~6.5 seconds (initialize + tools/call)
- **dry-run**: ~0.5 seconds (no MCP connection)

### Optimization Opportunities
1. Schema caching: `getTool` calls `listTools` every time
2. Batch mode: Consider `--batch` flag for multiple operations
3. Connection reuse: Future enhancement for performance-critical scenarios

---

## Documentation Quality

### Existing Documentation
- ✅ Clear JSDoc comments
- ✅ CLI help text with examples
- ✅ Updated main help menu (line 76)

### Missing Documentation
- ❌ No README section for new commands
- ❌ Stateless design rationale not documented
- ❌ No troubleshooting guide

### Recommendation
Add to README.md:
```markdown
## Tool Commands

Interact with MCP tools directly from the command line.

### List available tools
\`\`\`bash
pfscan tool ls <connector>
\`\`\`

### Show tool details
\`\`\`bash
pfscan tool show <connector> <tool-name>
\`\`\`

### Call a tool
\`\`\`bash
# Inline arguments
pfscan tool call <connector> <tool> --args '{"key":"value"}'

# From file
pfscan tool call <connector> <tool> --args-file args.json

# From stdin
echo '{"key":"value"}' | pfscan tool call <connector> <tool> --stdin

# Dry run (preview without execution)
pfscan tool call <connector> <tool> --args '{}' --dry-run
\`\`\`
```

---

## Recommendations

### Before Merge (Required)
1. ✅ Fix stdin handling with TTY check and timeout
2. ✅ Add timeout validation
3. ✅ Add file path validation for --args-file
4. ✅ Extract duplicate connector validation logic
5. ✅ Add comprehensive unit tests

### Future Enhancements (Optional)
1. Add batch mode for multiple tool calls
2. Implement connection caching for performance
3. Add error codes for programmatic usage
4. Update README with examples
5. Add shell completion for tool names

---

## Final Verdict

**Status**: ✅ **APPROVE WITH REQUESTED CHANGES**

The implementation is solid and adds valuable functionality. The critical issues (stdin handling, timeout validation) are straightforward to fix. Once addressed, this PR will significantly enhance proofscan's CLI capabilities.

The stateless design is particularly well-suited for CLI usage, and the multiple input methods (--args, --args-file, --stdin) provide excellent flexibility for different use cases.

---

## Validation Session Metadata

- **Validated By**: AI Assistant (Genspark Validation Lab)
- **Date**: 2026-01-03
- **Environment**: Genspark Sandbox
- **Node Version**: v20.19.6
- **MCP Server**: @modelcontextprotocol/server-everything
- **Test Duration**: ~10 minutes
- **Commands Tested**: 5 variations across 3 subcommands
- **Test Results**: 5/5 PASS (100% functional success)
