import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { INDEX_DIR, INDEX_FILE } from './constants'
import { indexSchema, type Index } from './schemas'

/** Default index location for a codebase root. */
export function indexPathFor(root: string): string {
  return join(root, INDEX_DIR, INDEX_FILE)
}

/** Read and validate an index file. Returns `null` if missing, unparseable, or invalid. */
export async function readIndex(path: string): Promise<Index | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = indexSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/** Write an index file, creating parent directories as needed. */
export async function writeIndex(path: string, index: Index): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}
