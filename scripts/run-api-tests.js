#!/usr/bin/env node
// Runs every database-backed test file in server/, discovered from disk.
//
// The list used to be written out by hand in package.json, so a new test file that was
// not added there silently never ran. Discovering the files closes that gap. (We list the
// files here instead of passing a glob to `node --test` because CI runs Node 20, which
// does not expand globs.)
//
// Anything not named below is treated as an API test and runs here.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// No database needed: run by `npm test`.
const UNIT = new Set(['field-registry.test.js', 'matching.test.js'])
// Run by their own scripts: `test:email`, and `test:resources` (needs real Google credentials).
const SEPARATE = new Set(['email.test.js', 'resources.test.js'])

const serverDir = new URL('../server/', import.meta.url)
const files = readdirSync(serverDir)
  .filter(f => f.endsWith('.test.js') && !UNIT.has(f) && !SEPARATE.has(f))
  .sort()
  .map(f => `server/${f}`)

console.log(`Running ${files.length} API test files:\n  ${files.join('\n  ')}\n`)

// --test-concurrency=1: the files share one test database.
const result = spawnSync(
  process.execPath,
  ['--env-file=.env', '--test', '--test-concurrency=1', ...process.argv.slice(2), ...files],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
