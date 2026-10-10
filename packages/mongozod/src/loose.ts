/** Values the types do not walk into: primitives, dates, regular expressions and BSON values. */
export type Leaf =
  | bigint
  | boolean
  | null
  | number
  | string
  | symbol
  | undefined
  | Date
  | RegExp
  | Uint8Array
  | { readonly _bsontype: string }

/**
 * A value as the code can write it: its arrays become readonly, so values inferred with `const`,
 * such as readonly tuples, still check.
 */
export type Loose<V> = V extends Leaf
  ? V
  : V extends ReadonlyArray<infer E>
    ? ReadonlyArray<Loose<E>>
    : { [K in keyof V]: Loose<V[K]> }
