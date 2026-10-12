import type { NextRequest } from 'next/server'

import { docsContentRoute, docsRoute } from '@/lib/shared'
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation'
import { NextResponse } from 'next/server'

// `/docs/<page>.md` serves the Markdown of the page.
const markdownSuffix = rewritePath(
  `${docsRoute}{/*path}.md`,
  `${docsContentRoute}{/*path}/content.md`
)
// `/docs/<page>` serves it too, to a client that prefers Markdown in its `Accept` header.
const markdownPage = rewritePath(`${docsRoute}{/*path}`, `${docsContentRoute}{/*path}/content.md`)

export default function proxy(request: NextRequest) {
  const suffixed = markdownSuffix.rewrite(request.nextUrl.pathname)

  if (suffixed) return NextResponse.rewrite(new URL(suffixed, request.nextUrl))

  const preferred = isMarkdownPreferred(request) && markdownPage.rewrite(request.nextUrl.pathname)

  if (preferred) {
    // The URL has two representations, chosen by `Accept`.
    return NextResponse.rewrite(new URL(preferred, request.nextUrl), {
      headers: { Vary: 'Accept' }
    })
  }

  return NextResponse.next()
}
