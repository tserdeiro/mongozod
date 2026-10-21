---
'mongozod': minor
---

`mz.term(schema, mask)` builds the search term a client can send, as in a search box: each word of the term has to appear in one of the declared paths, as part of a word, without telling case or accents apart. It builds a `$regex` per word and path from the escaped text, so the client never sends a pattern, and gives `{}` for an empty term. The Search recipe compares it with `$text` and MongoDB Search.
