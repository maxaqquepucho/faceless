import { z } from 'zod'

/** Severity levels for review findings, lowest to highest. */
export const severitySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type Severity = z.infer<typeof severitySchema>

/** Structured architecture summary produced by `CodeReader.summarize()`. */
export const architectureSummarySchema = z.object({
  techStack: z.array(z.string()),
  entryPoints: z.array(
    z.object({
      path: z.string(),
      description: z.string(),
    }),
  ),
  modules: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      responsibility: z.string(),
    }),
  ),
  dataFlow: z.string(),
  keyFiles: z.array(
    z.object({
      path: z.string(),
      why: z.string(),
    }),
  ),
})
export type ArchitectureSummary = z.infer<typeof architectureSummarySchema>

/** A single review finding produced by `CodeReader.review()`. */
export const findingSchema = z.object({
  file: z.string(),
  // Plain number (not `.int()`): structured-output schemas reject minimum/maximum.
  line: z.number(),
  severity: severitySchema,
  issue: z.string(),
  suggestion: z.string(),
})
export type Finding = z.infer<typeof findingSchema>

/** Top-level object the review model returns (structured output must be an object). */
export const reviewResultSchema = z.object({
  findings: z.array(findingSchema),
})
export type ReviewResult = z.infer<typeof reviewResultSchema>

/**
 * Convert a zod schema to the JSON Schema shape the Claude Agent SDK's
 * `outputFormat` expects. Strips `$schema`, which structured outputs don't use.
 */
export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json
}

/** One file's entry in the codebase index. */
export const indexEntrySchema = z.object({
  file: z.string(),
  purpose: z.string(),
  exports: z.array(z.string()),
  keySymbols: z.array(z.string()),
})
export type IndexEntry = z.infer<typeof indexEntrySchema>

/** Top-level object the indexer returns per batch (structured output must be an object). */
export const indexBatchSchema = z.object({
  entries: z.array(indexEntrySchema),
})
export type IndexBatch = z.infer<typeof indexBatchSchema>

/** The persisted `.faceless/index.json` shape, used to validate on read. */
export const indexSchema = z.object({
  version: z.number(),
  generatedAt: z.string(),
  root: z.string(),
  fileCount: z.number(),
  entries: z.array(indexEntrySchema),
})
export type Index = z.infer<typeof indexSchema>
