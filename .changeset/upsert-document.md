---
'mongozod': patch
---

An upsert validates the document the server inserts, as MongoDB builds it: a regular expression in
the filter matches instead of being copied, an `undefined` is copied as the `null` the driver
sends, and a filter that leaves the `_id` `null` throws a `ZodError`, also in a replacement, which
now validates the `_id` of its filter. A filter's value that the schema would store differently,
such as one that a transform changes, throws a `ZodError` too: the server copies it as it is.
