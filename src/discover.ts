import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { INDEX_DIR } from './constants'

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx',
  '.py', '.go', '.rs', '.java', '.rb', '.php', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.swift', '.kt', '.kts', '.scala', '.sh', '.bash', '.zsh',
  '.yaml', '.yml', '.toml', '.css', '.scss', '.sass', '.less', '.html', '.htm',
  '.vue', '.svelte', '.astro', '.sql', '.graphql', '.gql', '.proto', '.lua',
])

/** Directories skipped during the non-git fallback walk. */
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target',
  '__pycache__', 'venv', 'tmp', 'temp',
])

/** Noisy generated files skipped regardless of extension. */
const IGNORE_FILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb',
])

export interface DiscoverOptions {
  maxFileBytes: number
}

/**
 * Find source files under `root`. Prefers `git ls-files` (so `.gitignore` is
 * honored), falling back to a filtered recursive walk for non-git directories.
 * Returns sorted, root-relative paths using forward slashes.
 */
export function discoverFiles(root: string, options: DiscoverOptions): string[] {
  const candidates = discoverViaGit(root) ?? discoverViaWalk(root)
  const seen = new Set<string>()
  const out: string[] = []

  for (const rel of candidates) {
    const normalized = rel.split('\\').join('/')
    if (seen.has(normalized)) continue
    if (!hasCodeExtension(normalized)) continue
    if (IGNORE_FILES.has(basename(normalized))) continue
    if (normalized === INDEX_DIR || normalized.startsWith(`${INDEX_DIR}/`)) continue
    let st
    try {
      st = statSync(join(root, normalized))
    } catch {
      continue
    }
    if (!st.isFile() || st.size > options.maxFileBytes) continue
    seen.add(normalized)
    out.push(normalized)
  }

  return out.sort()
}

function discoverViaGit(root: string): string[] | null {
  try {
    const stdout = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return null
  }
}

function discoverViaWalk(root: string): string[] {
  const results: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(full)
      } else if (entry.isFile()) {
        results.push(relative(root, full))
      }
    }
  }
  walk(root)
  return results
}

function hasCodeExtension(rel: string): boolean {
  const dot = rel.lastIndexOf('.')
  if (dot < 0) return false
  return CODE_EXTENSIONS.has(rel.slice(dot).toLowerCase())
}

function basename(rel: string): string {
  const slash = rel.lastIndexOf('/')
  return slash < 0 ? rel : rel.slice(slash + 1)
}
