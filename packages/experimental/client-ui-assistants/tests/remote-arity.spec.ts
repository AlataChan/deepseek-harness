/** Source-plane guard for exact Typert argument tuples, including optional positions. */
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function source(url: URL): ts.SourceFile {
  return ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true)
}

function inspectCalls(client: ts.SourceFile, host: ts.SourceFile, discussion: ts.SourceFile): string[] {
  const hostArities = new Map<string, number>()
  const tupleArities = new Map<string, number>()
  const aliases = new Map<string, string>()
  const checked: string[] = []
  function visitHost(node: ts.Node): void {
    if (ts.isMethodDeclaration(node)) for (const decorator of ts.getDecorators(node) ?? []) {
      const call = decorator.expression
      if (ts.isCallExpression(call) && call.expression.getText(host) === 'Remote') {
        const name = call.arguments[0]
        if (name && ts.isStringLiteral(name)) hostArities.set(name.text, node.parameters.length)
      }
    }
    ts.forEachChild(node, visitHost)
  }
  function visitDiscussion(node: ts.Node): void {
    if (ts.isPropertySignature(node) && node.type && ts.isFunctionTypeNode(node.type)) {
      const parameters = node.type.parameters
      if (parameters.every(parameter => !parameter.questionToken && !parameter.initializer && !parameter.dotDotDotToken)) {
        tupleArities.set(node.name.getText(discussion), parameters.length)
      }
    }
    ts.forEachChild(node, visitDiscussion)
  }
  function remoteName(node: ts.Node): string | undefined {
    const callee = ts.isNonNullExpression(node) ? node.expression : node
    return ts.isPropertyAccessExpression(callee) && callee.expression.getText(client).replace(/!$/, '') === 'remote'
      ? callee.name.text : undefined
  }
  function visitAliases(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const target = remoteName(node.initializer)
      if (target) aliases.set(node.name.getText(client), target)
    }
    ts.forEachChild(node, visitAliases)
  }
  function visitCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = remoteName(node.expression) ?? aliases.get(node.expression.getText(client))
      if (name) {
        const expected = hostArities.get(name)
        expect(expected, `Unknown remote ${name}`).toBeDefined()
        const hasSpread = node.arguments.some(ts.isSpreadElement)
        if (hasSpread) {
          // Only complete, required discussion tuples may be forwarded with a spread.
          expect(node.arguments).toHaveLength(1)
          expect(tupleArities.get(name), `Unsafe optional tuple for ${name}`).toBe(expected)
        } else {
          expect(node.arguments.length, `${name} omits a declared wire position`).toBe(expected)
        }
        checked.push(name)
      }
    }
    ts.forEachChild(node, visitCalls)
  }
  visitHost(host)
  visitDiscussion(discussion)
  visitAliases(client)
  visitCalls(client)
  return checked
}

const host = source(new URL('../../assistant-registry/src/index.ts', import.meta.url))
const discussion = source(new URL('../src/client/TeamDiscussion.tsx', import.meta.url))
const client = source(new URL('../src/client/mount.ts', import.meta.url))

describe('Assistant remote wire argument tuples', () => {
  it('supplies every declared Host argument for all mounted remote calls', () => {
    const calls = inspectCalls(client, host, discussion)
    expect(calls.length).toBeGreaterThan(30)
    expect(calls).toContain('updateProfile')
    expect(calls).toContain('updateSeat')
    expect(calls).toContain('cancelRound')
  })

  it('rejects a missing optional profile revision position', () => {
    const invalid = ts.createSourceFile('invalid.ts', 'remote.updateProfile(id, options)', ts.ScriptTarget.Latest, true)
    expect(() => inspectCalls(invalid, host, discussion)).toThrow(/updateProfile/)
  })

  it('rejects a missing optional cancellation reason position', () => {
    const invalid = ts.createSourceFile('invalid.ts', 'remote.cancelRound(roundId)', ts.ScriptTarget.Latest, true)
    expect(() => inspectCalls(invalid, host, discussion)).toThrow(/cancelRound/)
  })
})
