import './UseCases.css'

function UseCases() {
  return (
    <div className="use-cases-page">
      <section className="page-hero">
        <div className="container">
          <h1>Use Cases</h1>
          <p className="lead">
            Real-world applications of proofscan for Agentic AI development and operations.
          </p>
        </div>
      </section>

      <section className="container py-5">
        <div className="use-case-section">
          <div className="use-case-header">
            <span className="use-case-icon">🔍</span>
            <h2>Debug AI Agent Integrations</h2>
          </div>
          <p className="use-case-description">
            When your AI agent isn't behaving as expected, proofscan helps you understand exactly what's happening at the protocol level.
          </p>
          
          <div className="use-case-scenario">
            <h3>Scenario: Tool Call Failures</h3>
            <p><strong>Problem:</strong> Your agent intermittently fails when calling a file system tool.</p>
            <p><strong>Solution with proofscan:</strong></p>
            
            <div className="code-block">
              <pre><code>{`# Capture all communication
pfscan scan start --id filesystem

# View recent events
pfscan view --connector filesystem --errors

# Inspect failing RPC
pfscan rpc show --session abc123 --id 5

# Analyze error patterns
pfscan analyze filesystem`}</code></pre>
            </div>
            
            <p><strong>Result:</strong> You discover the tool is receiving malformed file paths. The RPC inspection shows the exact request payload, helping you fix the agent's path generation logic.</p>
          </div>
        </div>

        <div className="use-case-section">
          <div className="use-case-header">
            <span className="use-case-icon">📈</span>
            <h2>Analyze Performance</h2>
          </div>
          <p className="use-case-description">
            Optimize your MCP server infrastructure by identifying bottlenecks and slow operations.
          </p>
          
          <div className="use-case-scenario">
            <h3>Scenario: Slow Agent Responses</h3>
            <p><strong>Problem:</strong> Your agent takes too long to respond to user queries.</p>
            <p><strong>Solution with proofscan:</strong></p>
            
            <div className="code-block">
              <pre><code>{`# Monitor all tool calls
pfscan view --method tools/call --limit 100

# Analyze latency patterns
pfscan analyze --sort-by latency

# Check specific session
pfscan tree my-session --rpc-all

# Generate performance report
pfscan view --since 24h --json > perf-report.json`}</code></pre>
            </div>
            
            <p><strong>Result:</strong> You identify that one specific tool (database query) is taking 3+ seconds. You optimize the query and reduce overall response time by 60%.</p>
          </div>
        </div>

        <div className="use-case-section">
          <div className="use-case-header">
            <span className="use-case-icon">🛡️</span>
            <h2>Security & Compliance Auditing</h2>
          </div>
          <p className="use-case-description">
            Generate audit trails for regulatory compliance while protecting sensitive data.
          </p>
          
          <div className="use-case-scenario">
            <h3>Scenario: SOC 2 Compliance</h3>
            <p><strong>Problem:</strong> Need to prove AI agent actions for audit, but can't share raw logs containing secrets.</p>
            <p><strong>Solution with proofscan:</strong></p>
            
            <div className="code-block">
              <pre><code>{`# Initialize POPL in your project
cd /path/to/project
pfscan popl init

# After agent execution, create audit entry
pfscan popl session --session abc123 \\
  --title "Customer Data Access - Case #1234" \\
  --description "Agent accessed customer records with approval"

# Review sanitized entry
cat .popl/entries/20260216-abc123/POPL.yml

# Share with auditors (safe - no secrets)
tar -czf audit-evidence.tar.gz .popl/entries/20260216-abc123/`}</code></pre>
            </div>
            
            <p><strong>Result:</strong> Auditors receive complete evidence of tool usage, timing, and outcomes—without any API keys, file paths, or PII. All payloads are SHA-256 hashed.</p>
          </div>
        </div>

        <div className="use-case-section">
          <div className="use-case-header">
            <span className="use-case-icon">🧪</span>
            <h2>Test & Validate MCP Servers</h2>
          </div>
          <p className="use-case-description">
            Create reproducible validation tests for your MCP servers to catch issues before production.
          </p>
          
          <div className="use-case-scenario">
            <h3>Scenario: CI/CD Integration Testing</h3>
            <p><strong>Problem:</strong> Need automated tests to verify MCP server behavior in CI pipeline.</p>
            <p><strong>Solution with proofscan:</strong></p>
            
            <div className="code-block">
              <pre><code>{`# Create validation plan (plan.yaml)
cat > plan.yaml << EOF
version: 1
name: weather-api-test
description: Validate weather API server
steps:
  - mcp: initialize
  - mcp: tools/list
  - when: capabilities.tools
    mcp: tools/call
    tool: get_forecast
    args:
      location: "Tokyo"
EOF

# Add plan
pfscan plans add weather-test --file plan.yaml

# Run in CI
pfscan plans run weather-test --connector weather --json > results.json

# Check exit code
if [ $? -eq 0 ]; then
  echo "✓ All validations passed"
else
  echo "✗ Validation failed"
  cat results.json
  exit 1
fi`}</code></pre>
            </div>
            
            <p><strong>Result:</strong> Your CI pipeline catches a regression where the weather server stopped returning forecast data. The plan execution log shows exactly which step failed.</p>
          </div>
        </div>

        <div className="use-case-section">
          <div className="use-case-header">
            <span className="use-case-icon">🎭</span>
            <h2>Aggregate Multiple MCP Servers</h2>
          </div>
          <p className="use-case-description">
            Simplify Claude Desktop configuration by combining multiple MCP servers into one endpoint.
          </p>
          
          <div className="use-case-scenario">
            <h3>Scenario: Claude Desktop Setup</h3>
            <p><strong>Problem:</strong> Managing 10+ MCP servers in Claude Desktop config is tedious. Each server uses resources.</p>
            <p><strong>Solution with proofscan:</strong></p>
            
            <div className="code-block">
              <pre><code>{`# Configure all servers in proofscan
pfscan config init
pfscan connectors import --from mcpServers --file claude_config.json

# Use proxy as single entry in Claude Desktop
# claude_desktop_config.json:
{
  "mcpServers": {
    "proofscan-proxy": {
      "command": "pfscan",
      "args": ["proxy", "start", "--all"]
    }
  }
}

# Monitor from terminal
pfscan proxy status
pfscan log --tail 20`}</code></pre>
            </div>
            
            <p><strong>Result:</strong> Single MCP server entry instead of 10+. All tools namespaced automatically (e.g., <code>time__get_current_time</code>). Full observability of all tool calls.</p>
          </div>
        </div>

        <div className="use-case-section">
          <div className="use-case-header">
            <span className="use-case-icon">📚</span>
            <h2>Document Tool Behavior</h2>
          </div>
          <p className="use-case-description">
            Generate accurate documentation by capturing real tool usage examples.
          </p>
          
          <div className="use-case-scenario">
            <h3>Scenario: API Documentation</h3>
            <p><strong>Problem:</strong> Need real examples of tool calls for documentation.</p>
            <p><strong>Solution with proofscan:</strong></p>
            
            <div className="code-block">
              <pre><code>{`# Run test scenarios
pfscan shell

# In shell mode
proofscan> cc myserver
proofscan> tool call get_data --args '{"id": 123}'

# Export RPC details
proofscan> rpc show @last --json > example-call.json

# Create POPL entry
proofscan> popl @last --title "get_data Example"

# Include in docs (sanitized, safe)
cat .popl/entries/20260216-abc/rpc.sanitized.jsonl`}</code></pre>
            </div>
            
            <p><strong>Result:</strong> Documentation includes real, working examples with exact request/response formats. No manual copying from logs or guessing at schemas.</p>
          </div>
        </div>

        <div className="use-case-section">
          <div className="use-case-header">
            <span className="use-case-icon">🔄</span>
            <h2>A2A (Agent-to-Agent) Debugging</h2>
          </div>
          <p className="use-case-description">
            Debug complex multi-agent interactions and workflows.
          </p>
          
          <div className="use-case-scenario">
            <h3>Scenario: Multi-Agent Workflow</h3>
            <p><strong>Problem:</strong> Agent A calls Agent B, which calls Agent C. Something fails in the chain.</p>
            <p><strong>Solution with proofscan:</strong></p>
            
            <div className="code-block">
              <pre><code>{`# Configure A2A agents
pfscan agent add agent-a --endpoint https://agent-a.example.com/a2a
pfscan agent add agent-b --endpoint https://agent-b.example.com/a2a

# Capture workflow execution
pfscan scan start --id agent-a

# View full chain
pfscan tree agent-a --rpc-all

# Export for analysis
pfscan view --connector agent-a --json > workflow.json

# Create audit trail
pfscan popl session --session abc123 --title "Multi-Agent Workflow"`}</code></pre>
            </div>
            
            <p><strong>Result:</strong> Full visibility into the agent call chain. You identify that Agent B is sending invalid data to Agent C, causing the downstream failure.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

export default UseCases
