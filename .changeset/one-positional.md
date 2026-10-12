---
'mongozod': patch
---

The editor suggests the positional `$` once in a path of an update, as MongoDB takes it: it
suggested paths such as `items.$.tags.$`, which the server rejects with code 2.
