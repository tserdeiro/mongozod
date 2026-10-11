---
'mongozod': minor
---

Export `ReadOf<M, O>`, the document a read of a model returns given the `projection` and the
`populate` of its options, to type a service or an API response without
`Awaited<ReturnType<…>>`: `ReadOf<typeof OrdersModel, { populate: { customer: true } }>`.
