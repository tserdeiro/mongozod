---
'mongozod': minor
---

`InsertOf<typeof Model>` is the document an insert or a replacement takes, with the fields that
`timestamps` and the plugins fill optional, for a function that builds one, such as a service:
`Parameters<typeof Model.insertOne>[0]` gave `never`, and `Input` asks for the timestamps.
