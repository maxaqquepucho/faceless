import { describe, it, expect } from 'vitest'
import { CodeReader } from '../src/index'

// Live tests: hit the real Claude Agent SDK and spend tokens.
// Opt in with FACELESS_LIVE=1 (via `npm run test:live`). Auth comes from
// ANTHROPIC_API_KEY or an existing `claude` CLI login.
const enabled = !!process.env.FACELESS_LIVE

describe.skipIf(!enabled)('live smoke', () => {
  it('ask() answers a question about its own repo', async () => {
    const reader = new CodeReader({ path: process.cwd() })
    const res = await reader.ask('In one sentence, what does this project do?')
    expect(res.data.trim().length).toBeGreaterThan(0)
    expect(res.cost).toBeGreaterThanOrEqual(0)
  }, 180_000)

  it('summarize() returns a structured architecture summary', async () => {
    const reader = new CodeReader({ path: process.cwd() })
    const { data } = await reader.summarize()
    expect(Array.isArray(data.techStack)).toBe(true)
    expect(Array.isArray(data.modules)).toBe(true)
    expect(typeof data.dataFlow).toBe('string')
  }, 240_000)

  it('review() returns structured findings (possibly empty)', async () => {
    const reader = new CodeReader({ path: process.cwd() })
    const { data } = await reader.review({ paths: ['src'] })
    expect(Array.isArray(data)).toBe(true)
    for (const f of data) {
      expect(typeof f.file).toBe('string')
      expect(['low', 'medium', 'high', 'critical']).toContain(f.severity)
    }
  }, 240_000)

  it('buildIndex() produces entries for source files', async () => {
    const reader = new CodeReader({ path: process.cwd() })
    const { index, batches } = await reader.buildIndex({ maxFiles: 4, write: false })
    expect(batches).toBeGreaterThan(0)
    expect(index.entries.length).toBeGreaterThan(0)
    expect(typeof index.entries[0]!.purpose).toBe('string')
  }, 300_000)
})
