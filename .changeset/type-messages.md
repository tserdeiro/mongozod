---
'mongozod': patch
---

Two compile errors read better. A projection kept in a variable, whose `0` TypeScript widens to a
`number`, says to declare it with `as const`, instead of listing what a projection takes. A key of
more in an insert or a replacement of a model with `timestamps` or plugins that fill fields shows
the fields the document takes, instead of `Simplify<Omit<…>>`.
