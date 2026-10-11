---
'mongozod': patch
---

A read with an inclusion projection that does not name the `_id` keeps it when it populates a
one-to-many reference: it was asked for and removed afterwards, as the `localField` of the
reference, when the server already returns it.
