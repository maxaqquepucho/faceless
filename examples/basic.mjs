// Minimal faceless example.
//
//   1. pnpm build
//   2. ensure ANTHROPIC_API_KEY is set (or you have a `claude` CLI login)
//   3. node examples/basic.mjs [path] ["question"]
//
// Defaults to reading this repo and asking what it does.

import { CodeReader } from '../dist/index.js'

const path = process.argv[2] ?? '.'
const question = process.argv[3] ?? 'In one sentence, what does this project do?'

const reader = new CodeReader({ path })
console.log(`Reading: ${reader.codebasePath}\n`)

const { data, cost } = await reader.ask(question)
console.log(data)
console.log(`\n— cost: $${cost.toFixed(4)}`)
