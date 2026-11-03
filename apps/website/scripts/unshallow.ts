// The date of each page comes from `git log`, so the build needs the whole history: with part of it,
// a page untouched since its oldest commit gets that commit's date. A clone marked shallow, as in
// GitHub Actions, fetches the rest. Vercel clones only the latest commits without marking the clone
// shallow, so the build checks for the first commit of the repository and fails without it, rather
// than publish wrong dates; `VERCEL_DEEP_CLONE=true` makes Vercel clone the whole history.
import { execFileSync } from 'node:child_process'

const firstCommit = 'ef5e3a461f369bdf2ac93fc780228b6889153e68'

const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' })

if (shallow.trim() === 'true') execFileSync('git', ['fetch', '--unshallow'], { stdio: 'inherit' })

const roots = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' })

if (!roots.split('\n').includes(firstCommit)) {
  throw new Error(
    'The clone lacks part of the Git history, which the dates of the pages come from. On Vercel, set the environment variable VERCEL_DEEP_CLONE=true.'
  )
}
