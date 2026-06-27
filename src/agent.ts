import { query, type Options, type NonNullableUsage } from '@anthropic-ai/claude-agent-sdk'
import { READ_TOOLS, WRITE_TOOLS } from './constants'
import { FacelessError } from './errors'
import type { Effort } from './types'

export interface RunParams {
  /** Working directory the agent reads from. */
  cwd: string
  /** The user-facing prompt for this run. */
  prompt: string
  /** System prompt describing the agent's role. */
  systemPrompt: string
  model: string
  effort: Effort
  allowBash: boolean
  loadProjectContext: boolean
  maxTurns?: number
  /** Optional JSON-schema output constraint; when set, `structured` is populated. */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  signal?: AbortSignal
  timeoutMs?: number
}

export interface RunResult {
  /** Final assistant text. */
  text: string
  /** Structured output when `outputFormat` was supplied, else `undefined`. */
  structured: unknown
  /** Total cost in USD. */
  cost: number
  usage: NonNullableUsage
  numTurns: number
}

/**
 * Run a single, read-only Claude Agent SDK query against `cwd` and return the
 * terminal result. The agent is restricted to read tools and never prompts for
 * permissions (`dontAsk`), so it is safe to run headless.
 */
export async function runAgent(params: RunParams): Promise<RunResult> {
  const tools: string[] = params.allowBash ? [...READ_TOOLS, 'Bash'] : [...READ_TOOLS]

  const abortController = new AbortController()
  const onExternalAbort = () => abortController.abort()
  if (params.signal) {
    if (params.signal.aborted) abortController.abort()
    else params.signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const timer =
    params.timeoutMs && params.timeoutMs > 0
      ? setTimeout(() => abortController.abort(), params.timeoutMs)
      : undefined

  const options: Options = {
    cwd: params.cwd,
    model: params.model,
    effort: params.effort,
    systemPrompt: params.systemPrompt,
    tools,
    allowedTools: tools,
    disallowedTools: [...WRITE_TOOLS],
    permissionMode: 'dontAsk',
    settingSources: params.loadProjectContext ? ['project'] : [],
    abortController,
    ...(params.maxTurns ? { maxTurns: params.maxTurns } : {}),
    ...(params.outputFormat ? { outputFormat: params.outputFormat } : {}),
  }

  try {
    for await (const message of query({ prompt: params.prompt, options })) {
      if (message.type !== 'result') continue
      if (message.subtype === 'success') {
        return {
          text: message.result,
          structured: message.structured_output,
          cost: message.total_cost_usd,
          usage: message.usage,
          numTurns: message.num_turns,
        }
      }
      throw new FacelessError(
        `Agent run did not succeed (subtype: ${message.subtype}).`,
        { subtype: message.subtype },
      )
    }
    throw new FacelessError('Agent stream ended without a result message.')
  } finally {
    if (timer) clearTimeout(timer)
    if (params.signal) params.signal.removeEventListener('abort', onExternalAbort)
  }
}
