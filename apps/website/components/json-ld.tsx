import type { Graph, Thing, WithContext } from 'schema-dts'

/**
 * Structured data for search engines and AI, as the JSON-LD guide of Next.js renders it: a script
 * with each `<` escaped, so no string of the data can close the tag.
 */
export function JsonLd({ data }: { data: WithContext<Thing> | Graph }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll('<', '\\u003c') }}
    />
  )
}
