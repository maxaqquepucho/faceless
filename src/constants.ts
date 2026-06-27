import type { Effort } from './types'

/** Default model used by every capability. */
export const DEFAULT_MODEL = 'claude-opus-4-8'

/** Default reasoning effort. */
export const DEFAULT_EFFORT: Effort = 'high'

/** The read-only tools the agent is allowed to use. */
export const READ_TOOLS = ['Read', 'Grep', 'Glob'] as const

/** Tools explicitly blocked, as a defense-in-depth backstop to the read-only toolset. */
export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const

/** On-disk index format version. */
export const INDEX_VERSION = 1

/** Directory (relative to the codebase root) where the index is stored. */
export const INDEX_DIR = '.faceless'

/** Index filename within `INDEX_DIR`. */
export const INDEX_FILE = 'index.json'

/** Number of files indexed per agent run. */
export const DEFAULT_INDEX_BATCH_SIZE = 20

/** Maximum number of files to index in one `buildIndex()` call. */
export const DEFAULT_INDEX_MAX_FILES = 400

/** Files larger than this (bytes) are skipped during discovery. */
export const DEFAULT_INDEX_MAX_FILE_BYTES = 262_144
