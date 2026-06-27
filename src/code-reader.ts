import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { runAgent, type RunParams } from './agent'
import {
  DEFAULT_EFFORT,
  DEFAULT_INDEX_BATCH_SIZE,
  DEFAULT_INDEX_MAX_FILES,
  DEFAULT_INDEX_MAX_FILE_BYTES,
  DEFAULT_MODEL,
  INDEX_VERSION,
} from './constants'
import { discoverFiles } from './discover'
import { FacelessError } from './errors'
import { indexPathFor, readIndex, writeIndex } from './index-store'
import {
  ASK_SYSTEM_PROMPT,
  INDEX_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SUMMARIZE_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  buildIndexPrompt,
  buildReviewPrompt,
  renderIndexContext,
} from './prompts'
import {
  architectureSummarySchema,
  indexBatchSchema,
  reviewResultSchema,
  toOutputSchema,
  type ArchitectureSummary,
  type Finding,
  type Index,
  type IndexEntry,
  type Severity,
} from './schemas'
import type {
  BuildIndexOptions,
  BuildIndexResult,
  CodeReaderOptions,
  Effort,
  Result,
  ReviewOptions,
  RunOptions,
} from './types'

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 }

type BaseRunParams = Pick<
  RunParams,
  'cwd' | 'model' | 'effort' | 'allowBash' | 'loadProjectContext' | 'maxTurns'
>

/**
 * Reads and understands a codebase via the Claude Agent SDK. Strictly read-only:
 * it can explore files but never modifies them.
 */
export class CodeReader {
  private readonly path: string
  private readonly model: string
  private readonly effort: Effort
  private readonly allowBash: boolean
  private readonly loadProjectContext: boolean
  private readonly maxTurns?: number

  constructor(options: CodeReaderOptions) {
    if (!options?.path) {
      throw new FacelessError('CodeReader requires a `path` to the codebase.')
    }
    const resolved = resolve(options.path)
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new FacelessError(`Path is not an existing directory: ${resolved}`)
    }
    this.path = resolved
    this.model = options.model ?? DEFAULT_MODEL
    this.effort = options.effort ?? DEFAULT_EFFORT
    this.allowBash = options.allowBash ?? false
    this.loadProjectContext = options.loadProjectContext ?? true
    this.maxTurns = options.maxTurns
  }

  /** The resolved absolute path being read. */
  get codebasePath(): string {
    return this.path
  }

  private base(): BaseRunParams {
    return {
      cwd: this.path,
      model: this.model,
      effort: this.effort,
      allowBash: this.allowBash,
      loadProjectContext: this.loadProjectContext,
      maxTurns: this.maxTurns,
    }
  }

  /** Load and render the index as a prompt prefix, or `''` if unavailable/disabled. */
  private async indexContext(useIndex?: boolean): Promise<string> {
    if (!useIndex) return ''
    const index = await readIndex(indexPathFor(this.path))
    if (!index || index.entries.length === 0) return ''
    return `${renderIndexContext(index.entries)}\n\n`
  }

  /** Ask a free-form question about the codebase. */
  async ask(question: string, runOptions?: RunOptions): Promise<Result<string>> {
    if (!question?.trim()) {
      throw new FacelessError('`question` must be a non-empty string.')
    }
    const context = await this.indexContext(runOptions?.useIndex)
    const result = await runAgent({
      ...this.base(),
      prompt: `${context}${question}`,
      systemPrompt: ASK_SYSTEM_PROMPT,
      signal: runOptions?.signal,
      timeoutMs: runOptions?.timeoutMs,
    })
    return { data: result.text, cost: result.cost, usage: result.usage }
  }

  /** Produce a structured architecture summary of the codebase. */
  async summarize(runOptions?: RunOptions): Promise<Result<ArchitectureSummary>> {
    const context = await this.indexContext(runOptions?.useIndex)
    const result = await runAgent({
      ...this.base(),
      prompt: `${context}${SUMMARIZE_PROMPT}`,
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      outputFormat: { type: 'json_schema', schema: toOutputSchema(architectureSummarySchema) },
      signal: runOptions?.signal,
      timeoutMs: runOptions?.timeoutMs,
    })
    const parsed = architectureSummarySchema.safeParse(result.structured)
    if (!parsed.success) {
      throw new FacelessError(
        'The model returned an architecture summary that did not match the expected schema.',
        { issues: parsed.error.issues, raw: result.structured },
      )
    }
    return { data: parsed.data, cost: result.cost, usage: result.usage }
  }

  /** Review the codebase and return structured findings. */
  async review(options: ReviewOptions = {}): Promise<Result<Finding[]>> {
    const context = await this.indexContext(options.useIndex)
    const result = await runAgent({
      ...this.base(),
      prompt: `${context}${buildReviewPrompt({ paths: options.paths, minSeverity: options.minSeverity })}`,
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      outputFormat: { type: 'json_schema', schema: toOutputSchema(reviewResultSchema) },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    })
    const parsed = reviewResultSchema.safeParse(result.structured)
    if (!parsed.success) {
      throw new FacelessError(
        'The model returned review findings that did not match the expected schema.',
        { issues: parsed.error.issues, raw: result.structured },
      )
    }
    let findings = parsed.data.findings
    if (options.minSeverity) {
      const min = SEVERITY_RANK[options.minSeverity]
      findings = findings.filter((f) => SEVERITY_RANK[f.severity] >= min)
    }
    return { data: findings, cost: result.cost, usage: result.usage }
  }

  /**
   * Walk the codebase, summarize each file into an index, and (by default)
   * write it to `.faceless/index.json`. Files are indexed in batches.
   */
  async buildIndex(options: BuildIndexOptions = {}): Promise<BuildIndexResult> {
    const batchSize = options.batchSize ?? DEFAULT_INDEX_BATCH_SIZE
    const maxFiles = options.maxFiles ?? DEFAULT_INDEX_MAX_FILES
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_INDEX_MAX_FILE_BYTES
    if (batchSize < 1) {
      throw new FacelessError('`batchSize` must be at least 1.')
    }

    const discovered = discoverFiles(this.path, { maxFileBytes })
    const truncated = discovered.length > maxFiles
    const files = truncated ? discovered.slice(0, maxFiles) : discovered

    const entries: IndexEntry[] = []
    let cost = 0
    let batches = 0

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      const result = await runAgent({
        ...this.base(),
        prompt: buildIndexPrompt(batch),
        systemPrompt: INDEX_SYSTEM_PROMPT,
        outputFormat: { type: 'json_schema', schema: toOutputSchema(indexBatchSchema) },
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      })
      batches += 1
      cost += result.cost
      const parsed = indexBatchSchema.safeParse(result.structured)
      if (!parsed.success) {
        throw new FacelessError(
          'The model returned an index batch that did not match the expected schema.',
          { issues: parsed.error.issues, raw: result.structured, batch },
        )
      }
      entries.push(...parsed.data.entries)
    }

    const index: Index = {
      version: INDEX_VERSION,
      generatedAt: new Date().toISOString(),
      root: this.path,
      fileCount: entries.length,
      entries,
    }

    let indexPath: string | undefined
    if (options.write !== false) {
      indexPath = options.outputPath ?? indexPathFor(this.path)
      await writeIndex(indexPath, index)
    }

    return { index, cost, batches, truncated, indexPath }
  }
}
