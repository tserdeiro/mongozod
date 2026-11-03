// The date of each page comes from `git log`, but Vercel clones the repository with --depth=10, so a
// page untouched in the last ten commits would get the date of the oldest one. A shallow clone
// fetches the rest of the history before the build; a full one, as in local builds, is left alone.
import { execFileSync } from 'node:child_process'

const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' })

if (shallow.trim() === 'true') execFileSync('git', ['fetch', '--unshallow'], { stdio: 'inherit' })
