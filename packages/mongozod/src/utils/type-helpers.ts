/** An object type with its intersections merged, so the editor shows its fields. */
export type Simplify<T> = { [K in keyof T]: T[K] }

/** The intersection of the members of a union. */
export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I
) => void
  ? I
  : never
