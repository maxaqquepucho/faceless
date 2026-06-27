# faceless

A small, reusable **read-only code-comprehension agent** for your next project. It
wraps the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
into a focused library: point it at a codebase and ask questions about it. It can
explore files but **never modifies them**.

> Status: Phase 3 — `ask()`, `summarize()`, `review()`, and `buildIndex()` are
> implemented. Next: packaging/publish polish.

## Install

```bash
pnpm add faceless
```

Requires **Node ≥ 18** and an `ANTHROPIC_API_KEY` in the environment (or an existing
`claude` CLI login).

## Usage

```ts
import { CodeReader } from 'faceless'

const reader = new CodeReader({ path: './my-next-project' })

const { data, cost, usage } = await reader.ask('How does authentication work?')
console.log(data)            // answer, with `file:line` citations
console.log(`$${cost}`)      // run cost in USD
```

### Capabilities

```ts
// Q&A — free-form, with file:line citations
const answer = await reader.ask('Where are routes registered?')

// Architecture summary — structured
const { data: summary } = await reader.summarize()
//   summary: { techStack, entryPoints[], modules[], dataFlow, keyFiles[] }

// Code review — structured findings, optionally scoped/filtered
const { data: findings } = await reader.review({
  paths: ['src/'],         // optional: restrict to these paths
  minSeverity: 'high',     // optional: 'low' | 'medium' | 'high' | 'critical'
})
//   findings: { file, line, severity, issue, suggestion }[]

// Index — walk the repo and cache a per-file map to .faceless/index.json
const { index, cost, batches } = await reader.buildIndex()
//   index.entries: { file, purpose, exports[], keySymbols[] }[]

// Then let queries use the index as navigation context
const fast = await reader.ask('Where is the agent loop?', { useIndex: true })
```

### Indexing

`buildIndex()` discovers source files (via `git ls-files` when available, so
`.gitignore` is honored; otherwise a filtered walk), indexes them in batches, and
writes `.faceless/index.json`.

```ts
await reader.buildIndex({
  batchSize: 20,        // files per agent run
  maxFiles: 400,        // cap (result.truncated flags if exceeded)
  maxFileBytes: 262144, // skip larger files
  write: true,          // set false to get the index without writing
  outputPath: undefined,// defaults to <root>/.faceless/index.json
})
```

Pass `{ useIndex: true }` to `ask`/`summarize`/`review` to inject the cached map
as navigation context (it's ignored if no index exists yet).

### Options

```ts
new CodeReader({
  path: './project',          // required: codebase to read (agent cwd)
  model: 'claude-opus-4-8',   // default
  effort: 'high',             // 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  allowBash: false,           // Bash can write, so it's off by default
  loadProjectContext: true,   // read the target's CLAUDE.md / project settings
  maxTurns: undefined,        // cap agentic turns
})
```

Every method accepts per-call `{ signal, timeoutMs }` and returns
`{ data, cost, usage }`.

## How it stays read-only

Each run restricts the agent's toolset to `Read`, `Grep`, and `Glob`, blocks the
write tools, and uses the SDK's `dontAsk` permission mode so it runs headless
without prompts and without the ability to change files.

## Development

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test            # unit tests (the live test is skipped)
pnpm test:live       # live smoke test — opt in; uses ANTHROPIC_API_KEY or a claude login
pnpm example         # run examples/basic.mjs (build first; needs auth)
```

See [`examples/basic.mjs`](./examples/basic.mjs) for a minimal end-to-end script.

This project uses **pnpm** (pinned via `packageManager`). With
[corepack](https://nodejs.org/api/corepack.html) enabled (`corepack enable`),
the right pnpm version is used automatically.

## License

MIT
