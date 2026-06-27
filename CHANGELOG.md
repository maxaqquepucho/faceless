# Changelog

## 0.1.0

Initial release — a read-only codebase-comprehension library on the Claude Agent SDK.

- `CodeReader` — strictly read-only agent (Read/Grep/Glob only, write tools blocked, `dontAsk` permission mode).
- `ask()` — free-form Q&A with `file:line` citations.
- `summarize()` — structured architecture summary (tech stack, entry points, modules, data flow, key files).
- `review()` — structured findings with `paths` scoping and `minSeverity` filtering.
- `buildIndex()` — discover source files (git-aware) and cache a per-file map to `.faceless/index.json`; pass `useIndex` to reuse it as navigation context.
