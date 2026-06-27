import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
}))

// Imported after vi.mock so the mock is in place.
import { CodeReader } from '../src/index'
import { discoverFiles } from '../src/discover'

async function* stream(...messages: unknown[]) {
  for (const m of messages) yield m
}

function indexResult(entries: unknown[]) {
  return {
    type: 'result',
    subtype: 'success',
    result: '{}',
    structured_output: { entries },
    total_cost_usd: 0.01,
    usage: { input_tokens: 5, output_tokens: 5 },
    num_turns: 1,
  }
}

function textResult(text: string) {
  return {
    type: 'result',
    subtype: 'success',
    result: text,
    structured_output: undefined,
    total_cost_usd: 0.01,
    usage: { input_tokens: 5, output_tokens: 5 },
    num_turns: 1,
  }
}

const entry = (file: string) => ({ file, purpose: `purpose of ${file}`, exports: [], keySymbols: [] })

let tmp: string
beforeEach(() => {
  queryMock.mockReset()
  tmp = mkdtempSync(join(tmpdir(), 'faceless-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('discoverFiles', () => {
  it('includes source files and excludes node_modules/dist for this repo', () => {
    const files = discoverFiles(process.cwd(), { maxFileBytes: 1_000_000 })
    expect(files).toContain('src/index.ts')
    expect(files.some((f) => f.startsWith('node_modules/'))).toBe(false)
    expect(files.some((f) => f.startsWith('dist/'))).toBe(false)
  })

  it('walks a non-git directory and filters by extension', () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const a = 1')
    writeFileSync(join(tmp, 'b.bin'), 'binary-ish')
    mkdirSync(join(tmp, 'node_modules'))
    writeFileSync(join(tmp, 'node_modules', 'c.ts'), 'export const c = 1')
    const files = discoverFiles(tmp, { maxFileBytes: 1_000_000 })
    expect(files).toContain('a.ts')
    expect(files).not.toContain('b.bin')
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
  })

  it('skips files larger than maxFileBytes', () => {
    writeFileSync(join(tmp, 'small.ts'), 'x')
    writeFileSync(join(tmp, 'big.ts'), 'x'.repeat(5000))
    const files = discoverFiles(tmp, { maxFileBytes: 1000 })
    expect(files).toContain('small.ts')
    expect(files).not.toContain('big.ts')
  })
})

describe('CodeReader.buildIndex', () => {
  it('indexes files in batches and aggregates cost', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const a = 1')
    writeFileSync(join(tmp, 'b.ts'), 'export const b = 2')
    // Fresh stream per call — an async generator is single-use.
    queryMock.mockImplementation(() => stream(indexResult([entry('x')])))
    const reader = new CodeReader({ path: tmp })
    const res = await reader.buildIndex({ batchSize: 1, write: false })
    expect(res.batches).toBe(2)
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(res.cost).toBeCloseTo(0.02)
    expect(res.index.entries).toHaveLength(2)
    expect(res.index.fileCount).toBe(2)
    expect(res.indexPath).toBeUndefined()
  })

  it('writes the index file when write is not false', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const a = 1')
    queryMock.mockReturnValue(stream(indexResult([entry('a.ts')])))
    const reader = new CodeReader({ path: tmp })
    const res = await reader.buildIndex()
    expect(res.indexPath).toBe(join(tmp, '.faceless', 'index.json'))
    expect(existsSync(res.indexPath!)).toBe(true)
    const onDisk = JSON.parse(readFileSync(res.indexPath!, 'utf8'))
    expect(onDisk.version).toBe(1)
    expect(onDisk.entries[0].file).toBe('a.ts')
  })

  it('requests json_schema output with an entries array', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'x')
    queryMock.mockReturnValue(stream(indexResult([entry('a.ts')])))
    const reader = new CodeReader({ path: tmp })
    await reader.buildIndex({ write: false })
    const { options } = queryMock.mock.calls[0]![0] as {
      options: { outputFormat: { type: string; schema: Record<string, any> } }
    }
    expect(options.outputFormat.type).toBe('json_schema')
    expect(options.outputFormat.schema.properties).toHaveProperty('entries')
  })

  it('flags truncation when discovered files exceed maxFiles', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'x')
    writeFileSync(join(tmp, 'b.ts'), 'x')
    writeFileSync(join(tmp, 'c.ts'), 'x')
    queryMock.mockReturnValue(stream(indexResult([entry('a.ts')])))
    const reader = new CodeReader({ path: tmp })
    const res = await reader.buildIndex({ maxFiles: 2, batchSize: 10, write: false })
    expect(res.truncated).toBe(true)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('handles an empty directory without calling the agent', async () => {
    const reader = new CodeReader({ path: tmp })
    const res = await reader.buildIndex({ write: false })
    expect(queryMock).not.toHaveBeenCalled()
    expect(res.batches).toBe(0)
    expect(res.index.entries).toHaveLength(0)
  })

  it('rejects an index batch that does not match the schema', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'x')
    queryMock.mockReturnValue(stream(indexResult([{ file: 'a.ts' }])))
    const reader = new CodeReader({ path: tmp })
    await expect(reader.buildIndex({ write: false })).rejects.toThrow()
  })
})

describe('index-backed queries', () => {
  function writeIndexFile(entries: Array<{ file: string; purpose: string }>) {
    mkdirSync(join(tmp, '.faceless'))
    const index = {
      version: 1,
      generatedAt: new Date().toISOString(),
      root: tmp,
      fileCount: entries.length,
      entries: entries.map((e) => ({ ...e, exports: [], keySymbols: [] })),
    }
    writeFileSync(join(tmp, '.faceless', 'index.json'), JSON.stringify(index))
  }

  it('injects the index map into ask() when useIndex is true', async () => {
    writeIndexFile([{ file: 'src/widget.ts', purpose: 'the widget' }])
    queryMock.mockReturnValue(stream(textResult('ok')))
    const reader = new CodeReader({ path: tmp })
    await reader.ask('what is the widget?', { useIndex: true })
    const { prompt } = queryMock.mock.calls[0]![0] as { prompt: string }
    expect(prompt).toContain('Project file map')
    expect(prompt).toContain('src/widget.ts — the widget')
    expect(prompt).toContain('what is the widget?')
  })

  it('does not inject a map when no index exists', async () => {
    queryMock.mockReturnValue(stream(textResult('ok')))
    const reader = new CodeReader({ path: tmp })
    await reader.ask('q', { useIndex: true })
    const { prompt } = queryMock.mock.calls[0]![0] as { prompt: string }
    expect(prompt).not.toContain('Project file map')
    expect(prompt).toBe('q')
  })

  it('does not inject a map when useIndex is omitted', async () => {
    writeIndexFile([{ file: 'src/widget.ts', purpose: 'the widget' }])
    queryMock.mockReturnValue(stream(textResult('ok')))
    const reader = new CodeReader({ path: tmp })
    await reader.ask('q')
    const { prompt } = queryMock.mock.calls[0]![0] as { prompt: string }
    expect(prompt).not.toContain('Project file map')
  })
})
