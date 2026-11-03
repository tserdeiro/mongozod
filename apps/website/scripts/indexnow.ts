// After a production deploy, tells the search engines that take IndexNow which pages changed since
// the previous one. Its FAQ asks for the changed URLs only, never the whole site, which the sitemap
// already lists.
import { execFileSync } from 'node:child_process'

// The search engines check a submission against public/<key>.txt, which holds this same key.
const key = '90462e27a03c13aa40a40fc581db36d7'
const host = 'mongozod.dev'
const { DEPLOYMENT_ID, GITHUB_REPOSITORY, GITHUB_TOKEN, SHA } = process.env

async function github(path: string) {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${GITHUB_TOKEN}` }
  })

  if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${path}`)

  return response.json()
}

// The commit of the last production deploy before this one that went live.
const deployments: Array<{ id: number; sha: string }> = await github(
  '/deployments?environment=Production&per_page=30'
)
let base: string | undefined

for (const deployment of deployments) {
  if (deployment.id >= Number(DEPLOYMENT_ID)) continue

  const statuses: Array<{ state: string }> = await github(`/deployments/${deployment.id}/statuses`)

  if (statuses.some(({ state }) => state === 'success')) {
    base = deployment.sha
    break
  }
}

if (base === undefined) {
  process.stdout.write('No earlier production deploy to compare with: nothing to submit.\n')
  process.exit()
}

// The pages of the docs that changed, removed ones included, and the home.
const files = execFileSync(
  'git',
  ['diff', '--name-only', base, `${SHA}`, '--', 'packages/docs', 'apps/website/app/(home)'],
  { encoding: 'utf8' }
)
const urls = new Set<string>()

for (const file of files.split('\n')) {
  if (file.startsWith('apps/website/')) urls.add(`https://${host}`)

  const page = /^packages\/docs\/(.+)\.md$/.exec(file)?.[1]

  if (page && page !== 'README') urls.add(`https://${host}/docs/${page}`.replace(/\/index$/, ''))
}

if (urls.size === 0) {
  process.stdout.write(`No page changed between ${base} and ${SHA}: nothing to submit.\n`)
  process.exit()
}

const response = await fetch('https://api.indexnow.org/IndexNow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: [...urls] })
})

if (!response.ok) throw new Error(`IndexNow answered ${response.status}: ${await response.text()}`)

process.stdout.write(`Submitted ${urls.size} URLs to IndexNow:\n${[...urls].join('\n')}\n`)
