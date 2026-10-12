import type { Blockquote, Parent, Root } from 'mdast'

// The Fumadocs callout of each GitHub alert, so `> [!WARNING]` looks on the site as on GitHub.
const callouts = new Map([
  ['NOTE', { type: 'info', title: 'Note' }],
  ['TIP', { type: 'idea', title: 'Tip' }],
  ['IMPORTANT', { type: 'info', title: 'Important' }],
  ['WARNING', { type: 'warn', title: 'Warning' }],
  ['CAUTION', { type: 'error', title: 'Caution' }]
])

/**
 * Turns the GitHub alerts of a page, blockquotes that start with `[!NOTE]`, `[!TIP]`,
 * `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`, into the `Callout` component of Fumadocs.
 */
export function remarkGithubAlerts() {
  return (tree: Root) => {
    visit(tree)
  }
}

function visit(node: Parent) {
  for (const child of node.children) {
    if (child.type === 'blockquote') toCallout(child)
    if ('children' in child) visit(child)
  }
}

function toCallout(blockquote: Blockquote) {
  const [first] = blockquote.children
  const [text] = first?.type === 'paragraph' ? first.children : []

  if (text?.type !== 'text') return

  const marker = /^\[!(\w+)\]\s*/.exec(text.value)
  const callout = callouts.get(marker?.[1] ?? '')

  if (!marker || !callout) return

  text.value = text.value.slice(marker[0].length)

  // A marker followed by a blank line leaves its paragraph empty.
  if (text.value === '' && first?.type === 'paragraph' && first.children.length === 1) {
    blockquote.children.shift()
  }

  blockquote.data = Object.assign(blockquote.data ?? {}, {
    hName: 'Callout',
    hProperties: callout
  })
}
