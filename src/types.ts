import type { EffortLevel, NonNullableUsage } from '@anthropic-ai/claude-agent-sdk'
import type { Index, Severity } from './schemas'

/** Reasoning effort level passed through to the Claude Agent SDK. */
export type Effort = EffortLevel

/** Token usage for a single run, as reported by the SDK. */
export type Usage = NonNullableUsage

export interface CodeReaderOptions {
  /** Path to the codebase to read. Becomes the agent's working directory. */
  path: string
  /** Model ID or alias. Defaults to `claude-opus-4-8`. */
  model?: string
  /** Reasoning effort. Defaults to `high`. */
  effort?: Effort
  /**
   * Allow the `Bash` tool. It is read-capable but can also write, so it is
   * off by default to keep runs strictly read-only.
   */
  allowBash?: boolean
  /**
   * Load the target repo's project settings (e.g. its `CLAUDE.md`) for extra
   * context. Defaults to `true`.
   */
  loadProjectContext?: boolean
  /** Maximum number of agentic turns before the run stops. */
  maxTurns?: number
}

/** Per-call options shared by every capability method. */
export interface RunOptions {
  /** Abort the run early. */
  signal?: AbortSignal
  /** Abort the run after this many milliseconds. */
  timeoutMs?: number
  /**
   * Inject the codebase's `.faceless/index.json` (if present) as navigation
   * context to help the agent find things faster. Defaults to `false`.
   */
  useIndex?: boolean
}

/** Options for `CodeReader.review()`. */
export interface ReviewOptions extends RunOptions {
  /** Restrict the review to these paths (relative to the codebase root). */
  paths?: string[]
  /** Drop findings below this severity (applied both in-prompt and post-hoc). */
  minSeverity?: Severity
}

/** Options for `CodeReader.buildIndex()`. */
export interface BuildIndexOptions {
  /** Files indexed per agent run. Defaults to 20. */
  batchSize?: number
  /** Cap on the number of files indexed. Defaults to 400. */
  maxFiles?: number
  /** Skip files larger than this many bytes. Defaults to 262144. */
  maxFileBytes?: number
  /** Write the index to disk. Defaults to `true`. */
  write?: boolean
  /** Where to write the index. Defaults to `<root>/.faceless/index.json`. */
  outputPath?: string
  /** Abort the run early. */
  signal?: AbortSignal
  /** Abort each batch after this many milliseconds. */
  timeoutMs?: number
}

/** Result of `CodeReader.buildIndex()`. */
export interface BuildIndexResult {
  /** The generated index. */
  index: Index
  /** Total cost across all batches, in USD. */
  cost: number
  /** Number of agent runs (batches) performed. */
  batches: number
  /** True if discovered files exceeded `maxFiles` and were capped. */
  truncated: boolean
  /** Absolute path the index was written to, or `undefined` when `write: false`. */
  indexPath?: string
}

/** Uniform return shape: the result plus what it cost to produce. */
export interface Result<T> {
  data: T
  /** Total cost of the run in USD. */
  cost: number
  /** Token usage for the run. */
  usage: Usage
}
