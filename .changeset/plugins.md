---
'mongozod': minor
---

Add plugins: `definePlugin` and the `plugins` option of `mongozod()`. A plugin declares the
`fields` the schema must have, `options` and `context` per group of operations (`read`, `insert`,
`update`, `delete`, `bulk`), `before` and `after` hooks per operation or group, a `middleware` that
wraps the operation, and `methods` for the model. Plugins run in layers, in the order of the list,
and their hooks receive the model to dispatch other operations. A group whose plugins declare a
context requires the options argument with `context`, which is validated per plugin.

`find` and `aggregate` now start their cursor on the first read, so their plugins see the
modifiers of the cursor, and an invalid projection or `populate` rejects when the cursor is read.
Plugins and services type what they take from the model with `FilterOf`, `SortOf`, `UpdateOf`,
`DocOf`, `ReadOptionsArg` and `UpdateOptionsArg`, which replace `ModelFilter`, `ModelSort` and
`ModelUpdate`.
