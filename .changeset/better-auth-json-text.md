---
'mongozod': patch
---

The Better Auth adapter reads a `json` field stored as text, as the official adapter and MongoZod 0.6 store it, as its value, as Better Auth does with its default. A write of the field stores the value, so no migration is needed.
