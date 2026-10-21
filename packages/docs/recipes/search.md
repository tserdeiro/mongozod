---
title: Search
description: Search a term in several fields, with MongoDB's text search, MongoDB Search, or mz.term for a search box without either.
---

A search box sends a term, and the app looks for it in several fields of each document. MongoDB has
two ways of its own, and `mz.term` covers the case neither does:

| Need                                                        | Use       | Runs on                                                           |
| ----------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| Whole words, without case or accents, ranked by relevance   | `$text`   | Every MongoDB, with a text index                                  |
| Search while typing, parts of words, typos                  | `$search` | MongoDB Search: Atlas, or a self-managed 8.2 or later, in preview |
| Search while typing, parts of words, without MongoDB Search | `mz.term` | Every MongoDB, without an index                                   |

## `$text`

A text index covers several fields, and `$text` matches whole words in any of them, without
telling case or accents apart. A collection takes one text index. Words are alternatives, and each
one in quotes is required:

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const noteSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string(),

  content: z.string(),

  organization: z.string()
})

const NotesModel = mongozod({

  collection: 'notes',

  db,

  schema: noteSchema,

  indexes: (index) => [
    index({ title: 'text', content: 'text' }, { default_language: 'none' })
  ]
})

// Notes with "cafe" or "leche" in the title or the content, such as `Café con leche`.
await NotesModel.find({ $text: { $search: 'cafe leche' } })

// Notes with both words.
await NotesModel.find({ $text: { $search: '"cafe" "leche"' } })
```

`$text` matches the complete word: `desay` does not find `Desayuno`, so it does not suit a box that
searches while the user types. `default_language: 'none'` matches the words as written; a language,
such as `spanish`, also matches their stems
([MongoDB docs](https://www.mongodb.com/docs/manual/reference/operator/query/text/)).

## `$search`

[MongoDB Search](https://www.mongodb.com/docs/atlas/atlas-search/) indexes the fields apart, and
`$search`, the first stage of an `aggregate`, finds parts of words with `autocomplete`, folds
accents with the `icuFolding` token filter and tolerates typos. It runs on Atlas and, from MongoDB
8.2, on a self-managed server with the `mongot` process, in public preview: MongoDB recommends that
one for testing, not for production. Its indexes are search indexes, which `sync()` does not
create.

```ts
const found = await NotesModel.aggregate([
  { $search: { index: 'notes', autocomplete: { query: 'desay', path: 'title' } } },
  { $limit: 20 }
])
```

## `mz.term`

Without MongoDB Search, [`mz.term`](../api/mzod.md#mzterm) turns the term into a filter with a
`$regex` per word and field: each word has to appear in one of the declared fields, as part of a
word, without telling case or accents apart. The client sends text, never a pattern: the builder
escapes it.

```ts
const listNotesSchema = z.object({

  filter: mz
    .filter(noteSchema, {
      organization: []
    })
    .required({ organization: true }),

  term: z.string()
    .max(100)
    .optional()
    .pipe(mz.term(noteSchema, { title: true, content: true }))
})

const { filter, term } = listNotesSchema.parse({ filter: { organization: 'acme' }, term: 'desay' })

await NotesModel.find({ $and: [filter, term] }, { maxTimeMS: 2000 })
// Finds a note whose content says `Desayuno de la mañana`
```

- **Length**: limit the term with Zod, as `.max(100)` above. Each word adds a `$regex` per field.
- **Cost**: a `$regex` that ignores case uses no index. It reads every document that the rest of
  the filter leaves, so filter by an indexed field too, such as the organization, and pass
  `maxTimeMS`.
- **Accents**: the Latin letters match their accented forms, such as `a` with `á`, `ä` and `ã`,
  and `n` with `ñ`, in both directions. Letters with no decomposition, such as `ø` or `ß`, match
  only themselves.

## Common mistakes

- **A `$regex` built from the client's text without escaping it**: a `[` makes the server fail,
  and `.` matches everything. Use `mz.term`, or escape it.
- **`$text` for a box that searches while typing**: it finds nothing until the word is complete.
- **`$search` on a self-managed server in production**: it is in preview there. Use `mz.term`, or
  move to Atlas.
