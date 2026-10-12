/** An object type with its intersections merged, so the editor shows its fields. */
export type Simplify<T> = { [K in keyof T]: T[K] }

/** The intersection of the members of a union. */
export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/**
 * Whether `K` is optional in `T`: an object without it fits only then. Comparing `Pick<T, K>` with
 * `Required<Pick<T, K>>` gives the same, but compares the type of the property, which costs more.
 */
export type IsOptionalKey<T, K extends keyof T> = object extends Pick<T, K> ? true : false

/**
 * `undefined` when `K` is optional in `T`. A check that maps the keys of a value keeps them
 * optional, and with `exactOptionalPropertyTypes` an optional key takes `undefined` only when its
 * type says so, as the outputs of Zod do.
 */
export type UndefinedIfOptional<T, K extends keyof T> =
  object extends Pick<T, K> ? undefined : never

/**
 * When `T` is a string, a property named after the problem, which the string lacks, so that the
 * error shows it: a check in a generic's constraint cannot be conditional on it. Or an `object`,
 * which a string is not either: a generic that is one passes, such as the sort that a function
 * forwards with `SortOf`.
 */
export type NotAString<T, Problem extends string> = T extends string
  ? { [K in Problem]: never } | object
  : unknown

/** Whether `T` is `any`, such as a value of the driver's `Document`, which a check cannot walk. */
export type IsAny<T> = 0 extends 1 & T ? true : false
