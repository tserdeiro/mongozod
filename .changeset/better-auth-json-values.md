---
'mongozod': minor
---

The Better Auth adapter stores a `json` field as a value instead of text, so the model of its table takes it with a schema such as a `z.object()`. Breaking for the `json` fields stored as text, such as by the official adapter: turn their text into values.
