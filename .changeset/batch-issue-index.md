---
'mongozod': patch
---

`insertMany` and `bulkWrite` throw one `ZodError` with the issues of every document or operation
that fails, each under its index, such as `[1, 'title']`: they reported the first one only, without
saying which.
