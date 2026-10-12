---
'mongozod': minor
---

A plugin declares in `fills` the fields of `fields` that its `before` hooks fill on inserts and
replacements, such as the `tenantId` of a multi-tenant plugin or the `createdBy` of an audit, and
those operations take them as optional, as they take the fields of `timestamps`. The schema still
validates them after the hooks.
