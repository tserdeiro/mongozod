---
'mongozod': patch
---

A plugin typed with its fields, such as a factory that returns
`Plugin<'tenant', { tenantId: z.ZodString }>`, fills none of them unless its `Fills` type parameter
names them, as `definePlugin` infers it: it filled every one, so an insert without them compiled and
threw a `ZodError`.
