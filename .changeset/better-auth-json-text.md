---
'mongozod': patch
---

The Better Auth adapter reads a `json` field stored as text, as the official adapter stores it, as its value, as Better Auth does with its default. A write of the field stores the value, so no migration is needed.
