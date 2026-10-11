import type { NotAPath, PathMode, SchemaAt } from '../../schema/schema-at'
import type { PathSuggestions } from '../../types/path-suggestions'

/** Checks the mask of paths a builder declares, like `.pick()`: each key is a path of the document. */
export type MaskCheck<S, K, M extends PathMode> = {
  [P in keyof K]: P extends string
    ? string extends P
      ? 'a path must be a literal'
      : [SchemaAt<S, P, M>] extends [never]
        ? NotAPath<P>
        : true
    : never
}

/** The paths the editor suggests in a mask. */
export type SuggestedMask<S, M extends PathMode> = { [P in PathSuggestions<S, M>]?: true }
