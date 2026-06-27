import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
}))

// Imported after vi.mock so the mock is in place.
import { CodeReader, FacelessError } from '../src/index'

async function* stream(...messages: unknown[]) {
  for (const m of messages) yield m
}

const successResult = {
  type: 'result',
  subtype: 'success',
  result: 'Faceless reads codebases.',
  structured_output: undefined,
  total_cost_usd: 0.0123,
  usage: { input_tokens: 10, output_tokens: 5 },
  num_turns: 2,
}

function resultWith(structured: unknown) {
  return {
    type: 'result',
    subtype: 'success',
    result: JSON.stringify(structured),
    structured_output: structured,
    total_cost_usd: 0.02,
    usage: { input_tokens: 20, output_tokens: 10 },
    num_turns: 1,
  }
}

const validSummary = {
  techStack: ['TypeScript'],
  entryPoints: [{ path: 'src/index.ts', description: 'public exports' }],
  modules: [{ name: 'agent', path: 'src/agent.ts', responsibility: 'runs query()' }],
  dataFlow: 'caller -> CodeReader -> runAgent -> SDK',
  keyFiles: [{ path: 'src/agent.ts', why: 'core runner' }],
}

const validReview = {
  findings: [
    { file: 'a.ts', line: 1, severity: 'low', issue: 'minor', suggestion: 'tidy it' },
    { file: 'b.ts', line: 2, severity: 'high', issue: 'bug', suggestion: 'fix it' },
  ],
}

beforeEach(() => {
  queryMock.mockReset()
})

describe('CodeReader', () => {
  it('throws if the path does not exist', () => {
    expect(() => new CodeReader({ path: '/no/such/dir/xyz-faceless' })).toThrow(FacelessError)
  })

  it('throws if no path is given', () => {
    // @ts-expect-error intentionally invalid
    expect(() => new CodeReader({})).toThrow(FacelessError)
  })

  it('exposes the resolved codebase path', () => {
    const reader = new CodeReader({ path: '.' })
    expect(reader.codebasePath).toBe(process.cwd())
  })

  it('ask() returns the result text, cost, and usage', async () => {
    queryMock.mockReturnValue(stream(successResult))
    const reader = new CodeReader({ path: process.cwd() })
    const res = await reader.ask('what does this do?')
    expect(res.data).toBe('Faceless reads codebases.')
    expect(res.cost).toBeCloseTo(0.0123)
    expect(res.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
  })

  it('configures a read-only agent (read tools, dontAsk, resolved cwd, default model)', async () => {
    queryMock.mockReturnValue(stream(successResult))
    const reader = new CodeReader({ path: process.cwd() })
    await reader.ask('q')
    const { options } = queryMock.mock.calls[0]![0] as { options: Record<string, unknown> }
    expect(options.cwd).toBe(process.cwd())
    expect(options.tools).toEqual(['Read', 'Grep', 'Glob'])
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob'])
    expect(options.disallowedTools).toContain('Write')
    expect(options.disallowedTools).toContain('Edit')
    expect(options.permissionMode).toBe('dontAsk')
    expect(options.model).toBe('claude-opus-4-8')
    expect(options.settingSources).toEqual(['project'])
  })

  it('omits project settings when loadProjectContext is false', async () => {
    queryMock.mockReturnValue(stream(successResult))
    const reader = new CodeReader({ path: process.cwd(), loadProjectContext: false })
    await reader.ask('q')
    const { options } = queryMock.mock.calls[0]![0] as { options: Record<string, unknown> }
    expect(options.settingSources).toEqual([])
  })

  it('includes Bash only when allowBash is true', async () => {
    queryMock.mockReturnValue(stream(successResult))
    const reader = new CodeReader({ path: process.cwd(), allowBash: true })
    await reader.ask('q')
    const { options } = queryMock.mock.calls[0]![0] as { options: { tools: string[] } }
    expect(options.tools).toContain('Bash')
  })

  it('rejects when the agent does not succeed', async () => {
    queryMock.mockReturnValue(stream({ type: 'result', subtype: 'error_max_turns' }))
    const reader = new CodeReader({ path: process.cwd() })
    await expect(reader.ask('q')).rejects.toBeInstanceOf(FacelessError)
  })

  it('rejects when no result message is produced', async () => {
    queryMock.mockReturnValue(stream({ type: 'assistant' }))
    const reader = new CodeReader({ path: process.cwd() })
    await expect(reader.ask('q')).rejects.toBeInstanceOf(FacelessError)
  })

  it('rejects an empty question', async () => {
    const reader = new CodeReader({ path: process.cwd() })
    await expect(reader.ask('   ')).rejects.toBeInstanceOf(FacelessError)
  })
})

describe('CodeReader.summarize', () => {
  it('returns the validated structured summary', async () => {
    queryMock.mockReturnValue(stream(resultWith(validSummary)))
    const reader = new CodeReader({ path: process.cwd() })
    const res = await reader.summarize()
    expect(res.data).toEqual(validSummary)
    expect(res.cost).toBeCloseTo(0.02)
  })

  it('requests json_schema output for the summary', async () => {
    queryMock.mockReturnValue(stream(resultWith(validSummary)))
    const reader = new CodeReader({ path: process.cwd() })
    await reader.summarize()
    const { options } = queryMock.mock.calls[0]![0] as {
      options: { outputFormat: { type: string; schema: Record<string, any> } }
    }
    expect(options.outputFormat.type).toBe('json_schema')
    expect(options.outputFormat.schema.properties).toHaveProperty('techStack')
    expect(options.outputFormat.schema.additionalProperties).toBe(false)
  })

  it('rejects when the summary does not match the schema', async () => {
    queryMock.mockReturnValue(stream(resultWith({ techStack: 'not-an-array' })))
    const reader = new CodeReader({ path: process.cwd() })
    await expect(reader.summarize()).rejects.toBeInstanceOf(FacelessError)
  })
})

describe('CodeReader.review', () => {
  it('returns the findings array', async () => {
    queryMock.mockReturnValue(stream(resultWith(validReview)))
    const reader = new CodeReader({ path: process.cwd() })
    const res = await reader.review()
    expect(res.data).toHaveLength(2)
    expect(res.data[0]!.severity).toBe('low')
  })

  it('requests json_schema output for review', async () => {
    queryMock.mockReturnValue(stream(resultWith(validReview)))
    const reader = new CodeReader({ path: process.cwd() })
    await reader.review()
    const { options } = queryMock.mock.calls[0]![0] as {
      options: { outputFormat: { type: string; schema: Record<string, any> } }
    }
    expect(options.outputFormat.type).toBe('json_schema')
    expect(options.outputFormat.schema.properties).toHaveProperty('findings')
  })

  it('filters findings below minSeverity and scopes the prompt', async () => {
    queryMock.mockReturnValue(stream(resultWith(validReview)))
    const reader = new CodeReader({ path: process.cwd() })
    const res = await reader.review({ minSeverity: 'high', paths: ['src/agent.ts'] })
    expect(res.data).toHaveLength(1)
    expect(res.data[0]!.severity).toBe('high')
    const call = queryMock.mock.calls[0]![0] as { prompt: string }
    expect(call.prompt).toContain('src/agent.ts')
    expect(call.prompt).toContain('high')
  })

  it('rejects when findings do not match the schema', async () => {
    queryMock.mockReturnValue(stream(resultWith({ findings: [{ file: 'a.ts' }] })))
    const reader = new CodeReader({ path: process.cwd() })
    await expect(reader.review()).rejects.toBeInstanceOf(FacelessError)
  })
})
