/** Host rewrite of invalid create_page type/role before sidecar apply. */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  rewriteInvalidCreatePageMeta, rewriteProposalPageMetaFile,
} from '../src/proposal-page-meta.ts'

describe('proposal page-meta rewrite', () => {
  it('rewrites wiki type and role to note', () => {
    const proposal = {
      operations: [
        { op: 'add_alias' },
        { op: 'create_page' },
        {
          op: 'create_page',
          frontmatter: { type: 'wiki', role: 'wiki', title: '测试文档' },
        },
      ],
    }
    expect(rewriteInvalidCreatePageMeta(proposal)).toBe(true)
    expect(proposal.operations[2]).toMatchObject({
      frontmatter: { type: 'note', role: 'note', title: '测试文档' },
    })
    expect(rewriteInvalidCreatePageMeta(proposal)).toBe(false)
  })

  it('keeps a valid type and ignores non-proposal values', () => {
    expect(rewriteInvalidCreatePageMeta(null)).toBe(false)
    expect(rewriteInvalidCreatePageMeta({})).toBe(false)
    expect(rewriteInvalidCreatePageMeta({ operations: 'x' })).toBe(false)
    expect(rewriteInvalidCreatePageMeta({ operations: [null, 'x'] })).toBe(false)
    const proposal = {
      operations: [{
        op: 'create_page',
        frontmatter: { type: 'concept', role: 'concept' },
      }],
    }
    expect(rewriteInvalidCreatePageMeta(proposal)).toBe(false)
    const roleOnly = {
      operations: [{
        op: 'create_page',
        frontmatter: { type: 'concept', role: 'wiki' },
      }],
    }
    expect(rewriteInvalidCreatePageMeta(roleOnly)).toBe(true)
    expect(roleOnly.operations[0]?.frontmatter).toEqual({ type: 'concept', role: 'concept' })
    const emptyFields = {
      operations: [{ op: 'create_page', frontmatter: {} }],
    }
    expect(rewriteInvalidCreatePageMeta(emptyFields)).toBe(true)
    expect(emptyFields.operations[0]?.frontmatter).toEqual({ type: 'note', role: 'note' })
    const metaType = {
      operations: [{ op: 'create_page', frontmatter: { type: 'meta', role: 'wiki' } }],
    }
    expect(rewriteInvalidCreatePageMeta(metaType)).toBe(true)
    expect(metaType.operations[0]?.frontmatter).toEqual({ type: 'meta', role: 'note' })
  })

  it('writes only when the proposal file needs a rewrite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-knowledge-page-meta-'))
    const path = join(dir, 'prop.json')
    await writeFile(path, JSON.stringify({
      operations: [{ op: 'create_page', frontmatter: { type: 'wiki', role: 'wiki' } }],
    }))
    await rewriteProposalPageMetaFile(path)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      operations: [{ frontmatter: { type: 'note', role: 'note' } }],
    })
    const unchanged = join(dir, 'ok.json')
    await writeFile(unchanged, '{"operations":[]}\n')
    await rewriteProposalPageMetaFile(unchanged)
    expect(await readFile(unchanged, 'utf8')).toBe('{"operations":[]}\n')
  })
})
