/**
 * Test-only stdio MCP server. Production supervisor does not import this file.
 * The startup test spawns it as the supervisor's child so the child holds fd 3.
 */
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

async function serve(): Promise<void> {
  const delay = Number(process.env.AD_FIXTURE_START_DELAY_MS ?? '0')
  if (Number.isFinite(delay) && delay > 0) {
    await new Promise<void>((resolve) => { setTimeout(resolve, delay) })
  }
  const server = new McpServer({ name: 'desktop-operation-fixture', version: '0.0.0' })
  server.registerTool('hold', {
    description: 'Wait until the caller cancels.',
    inputSchema: z.object({}),
  }, async (_args, context) => {
    const ready = process.env.AD_FIXTURE_READY
    if (ready !== undefined && ready !== '') await writeFile(ready, 'ready')
    const signal = context.mcpReq.signal
    await new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return }
      signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
    return { content: [{ type: 'text', text: 'cancelled' }] }
  })
  serveStdio(() => server)
}

function invoked(argv: readonly string[]): boolean {
  return argv.some((entry) => {
    const name = basename(entry)
    return name === 'mcp-server.ts' || name === 'mcp-server.js'
  })
}

if (invoked(process.argv)) {
  serve().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
