import type { NotAPath, SchemaAt } from '../schema/schema-at'
import type { PathSuggestions } from '../types/path-suggestions'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { schemaAt } from '../schema/schema-at'

/** The `$regex` that one word of a term gives each path. */
export interface TermRegex {
  $options: 'i'
  $regex: string
}

/** The filter a term gives: each of its words in one of the paths `K`. */
export interface TermFilter<K extends string> {
  $and?: Array<{ $or: Array<{ [P in K]?: TermRegex }> }>
}

/** Whether a path of the document holds strings, the only values `$regex` matches. */
type IsString<S, P extends string> = [
  Extract<core.output<SchemaAt<S, P, 'filter'>>, string | ReadonlyArray<string>>
] extends [never]
  ? false
  : true

/** Checks the mask of `mz.term`: each key is a path of the document that holds strings. */
export type TermMaskCheck<S, K> = {
  [P in keyof K]: P extends string
    ? string extends P
      ? 'a path must be a literal'
      : [SchemaAt<S, P, 'filter'>] extends [never]
        ? NotAPath<P>
        : IsString<S, P> extends true
          ? true
          : `"${P}" does not hold strings, which a term searches`
    : never
}

/** The paths the editor suggests in the mask of `mz.term`: the ones that hold strings. */
export type SuggestedTermMask<S> = {
  [P in PathSuggestions<S, 'filter'> as IsString<S, P> extends true ? P : never]?: true
}

/** The special characters of a regular expression, as MDN's `escapeRegExp` escapes them. */
const SPECIAL = /[.*+?^${}()|[\]\\]/g

/**
 * The accented forms of each Latin letter, from Unicode: the letters of Latin-1 and Latin Extended
 * whose decomposition starts with it, such as `á`, `ä` and `ã` for `a`, `ç` for `c` and `ñ` for
 * `n`. `$options: 'i'` covers the case.
 */
const VARIANTS = new Map<string, string>()

for (let code = 0xc0; code <= 0x24f; code++) {
  const letter = String.fromCodePoint(code).toLowerCase()
  const base = letter.normalize('NFD')[0]

  const variants = VARIANTS.get(base ?? '') ?? base ?? ''

  // `İ` lowercases to two characters, an `i` and a combining dot, which a class would take apart.
  if (
    base &&
    letter.length === 1 &&
    base !== letter &&
    /^[a-z]$/.test(base) &&
    !variants.includes(letter)
  ) {
    VARIANTS.set(base, `${variants}${letter}`)
  }
}

/** One word as a pattern: without its accents, escaped, and each letter matching its variants. */
function wordPattern(word: string): string {
  return word
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/./gsu, (char) => {
      const variants = VARIANTS.get(char)

      return variants ? `[${variants}]` : char.replace(SPECIAL, '\\$&')
    })
}

/**
 * The search term a client can send, as in a search box: the router gets a filter in which each
 * word of the term appears in one of the declared paths, without telling uppercase from lowercase
 * or accents apart, so `cafe` finds `Café`. It builds a `$regex` per word and path, with the
 * client's text escaped: the client never sends a pattern. An empty or missing term gives `{}`.
 *
 * It finds parts of words, as a search while typing needs, which `$text` does not, and it needs no
 * index; but a `$regex` that ignores case reads every document the rest of the filter leaves, so
 * limit the length of the term with Zod and the time of the query with `maxTimeMS`. With MongoDB
 * Search, `$search` does the same with an index.
 *
 * @example
 *   term: z.string().max(100).optional().pipe(mz.term(noteSchema, { title: true, content: true }))
 *
 * @see https://mongozod.dev/docs/api/mzod#mzterm
 */
export function term<S extends core.$ZodType, const K extends TermMaskCheck<S, K>>(
  schema: S,
  mask: K & SuggestedTermMask<S>
): z.ZodPrefault<z.ZodType<TermFilter<keyof K & string>, string>>

export function term(schema: core.$ZodType, mask: Readonly<Record<string, true>>): z.ZodType {
  const paths = Object.keys(mask)

  for (const path of paths) {
    if (schemaAt(schema, path, 'filter').length === 0) {
      throw new Error(`mz.term: "${path}" is not a path of the document`)
    }
  }

  if (paths.length === 0) throw new Error('mz.term: declare at least one path')

  return z
    .string()
    .transform((text) => {
      const words = text.split(/\s+/).filter(Boolean)

      if (words.length === 0) return {}

      return {
        $and: words.map((word) => {
          const regex = { $options: 'i', $regex: wordPattern(word) }

          return { $or: paths.map((path) => ({ [path]: regex })) }
        })
      }
    })
    .prefault('')
}
