function CliGuide() {
  return (
    <div>
      <h1>CLI Guide</h1>
      <p>Complete command reference for proofscan CLI. For interactive shell mode, see the Shell Mode guide.</p>
      <h2>Core Commands</h2>
      <h3>pfscan view</h3>
      <p>Display timeline of recent events.</p>
      <pre><code>{`pfscan view --limit 20
pfscan view --connector time --errors
pfscan view --since 24h --json`}</code></pre>
      <h3>pfscan tree</h3>
      <p>Show hierarchical connector → session → RPC structure.</p>
      <pre><code>{`pfscan tree
pfscan tree time --rpc-all
pfscan tree --status err`}</code></pre>
      <p>See the <a href="https://github.com/proofofprotocol/proofscan/blob/main/docs/GUIDE.md" target="_blank">full CLI Guide</a> for complete documentation.</p>
    </div>
  )
}

export default CliGuide
