# `softDelete`

Borrado lógico. Se importa de `mongozod/plugins/soft-delete` y se suma al modelo con
`plugins: [softDelete()]`, como en [El modelo](../model.md).

## Regla

**Si el filtro menciona `deletedAt`, el plugin no lo toca.** Se fija en el primer nivel del filtro y
dentro de `$and`, `$or` y `$nor`. Es el criterio del ejemplo oficial de soft delete que publicaba
Prisma, que excluía los borrados solo si no se pedían explícitamente. Así el plugin no suma
opciones ni métodos: todo se expresa con filtros de Mongo.

## Comportamiento

- **Lecturas y updates**: si el filtro no menciona `deletedAt`, el plugin agrega
  `deletedAt: { $exists: false }`. El filtro del usuario se envuelve en `$and` y no se modifica. Hoy
  `find` sí lo modifica, y `filter.deletedAt ??=` falla cuando el router envuelve el filtro en
  `$and`.
- **Borrado**: `deleteOne` y `deleteMany` marcan `deletedAt` con un `updateOne` o un `updateMany`
  despachados por el modelo, así [`timestamps`](./timestamps.md), [auditoría](./audit.md) e
  [historial](./history.md) ven un update. Devuelven un
  `DeleteResult` cuyo `deletedCount` cuenta los documentos marcados. Un documento ya borrado no se
  vuelve a marcar: el segundo borrado da `deletedCount: 0`.
- **Borrado real**: si el filtro de un borrado menciona `deletedAt`, borra de verdad. Así se vacía
  la papelera.
- **Condición `$exists: false`**: se usa en vez de `deletedAt: null` porque un upsert no la copia al
  documento nuevo. MongoDB sí copia `deletedAt: null`, y eso no cumple el schema.

| Quiero                             | Cómo                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| Los documentos vivos               | `find({ organization })`                                                               |
| La papelera                        | `find({ organization, deletedAt: { $exists: true } })`                                 |
| Todos                              | `find({ $or: [{ deletedAt: { $exists: true } }, { deletedAt: { $exists: false } }] })` |
| Borrar                             | `deleteOne({ _id })`, que marca `deletedAt`                                            |
| Restaurar                          | `updateOne({ _id, deletedAt: { $exists: true } }, { $unset: { deletedAt: '' } })`      |
| Borrar un documento vivo de verdad | `deleteOne({ _id, deletedAt: { $exists: false } })`                                    |
| Vaciar la papelera                 | `deleteMany({ deletedAt: { $lt: limite } })`                                           |

## Código

```ts
import type { Filter } from 'mongozod'
import type { Document } from 'mongodb'

import { z } from 'zod'

import { definePlugin } from 'mongozod'

const LOGICAL_OPERATORS = new Set(['$and', '$nor', '$or'])

/** Without `deletedAt`. Unlike `deletedAt: null`, an upsert does not copy it into the new document. */
const NOT_DELETED = { deletedAt: { $exists: false } }

/** True when the filter already says something about `deletedAt`, here or inside `$and`/`$or`/`$nor`. */
function mentionsDeletedAt(filter: Filter<Document>): boolean {
  return Object.entries(filter).some(
    ([key, value]) =>
      key === 'deletedAt' ||
      (LOGICAL_OPERATORS.has(key) && Array.isArray(value) && value.some(mentionsDeletedAt))
  )
}

/** Adds the soft delete condition, unless the caller's filter already decides about `deletedAt`. */
function excludeDeleted(filter: Filter<Document>): Filter<Document> {
  if (mentionsDeletedAt(filter)) return filter

  return { $and: [filter, NOT_DELETED] }
}

/**
 * Soft delete. Reads and updates skip documents with `deletedAt`, and deletes stamp it instead of
 * removing the document. A filter that mentions `deletedAt` takes over: the plugin leaves it alone,
 * so `{ deletedAt: { $exists: true } }` reads the trash and a delete with it removes for real.
 */
export function softDelete() {
  return definePlugin({
    id: 'softDelete',

    fields: {
      deletedAt: z.date().optional()
    },

    hooks: {
      deleteMany: {
        async before({ args, context, model }) {
          if (mentionsDeletedAt(args.filter)) return

          const result = await model.updateMany(
            args.filter,
            { $set: { deletedAt: new Date() } },
            { ...args.options, context }
          )

          return {
            result: { acknowledged: result.acknowledged, deletedCount: result.modifiedCount }
          }
        }
      },

      deleteOne: {
        async before({ args, context, model }) {
          if (mentionsDeletedAt(args.filter)) return

          const result = await model.updateOne(
            args.filter,
            { $set: { deletedAt: new Date() } },
            { ...args.options, context }
          )

          return {
            result: { acknowledged: result.acknowledged, deletedCount: result.modifiedCount }
          }
        }
      },

      read: {
        before: ({ args }) => ({ args: { ...args, filter: excludeDeleted(args.filter) } })
      },

      update: {
        before: ({ args }) => ({ args: { ...args, filter: excludeDeleted(args.filter) } })
      }
    }
  })
}
```

El prototipo cubre `find`, `findOne`, `countDocuments`, `updateOne`, `updateMany`, `deleteOne` y
`deleteMany`. Las demás operaciones siguen estas mismas reglas.

## Decisiones del soft delete

1. **Upsert**: la condición es `$exists: false`, así el upsert no ensucia el documento nuevo. Un
   upsert sobre el `_id` de un documento borrado lanza el error de clave duplicada del driver, en
   vez de restaurarlo sin avisar. Para restaurar hay que hacerlo de forma explícita.
2. **`aggregate`**: no se filtra. Quien escribe el pipeline agrega su propio `$match`. Insertarlo de
   forma automática choca con las etapas que, según la documentación de MongoDB, tienen que ir
   primeras, como `$geoNear` o `$search`.
3. **`estimatedDocumentCount`**: no se toca, y se documenta que cuenta también los borrados. El
   driver lo estima con la metadata de la colección, sin filtro. Convertirlo en `countDocuments`
   cambiaría su costo sin avisar.
4. **`findOneAndDelete`**: devuelve el documento como estaba antes de marcarlo, igual que el driver
   devuelve el documento borrado.
5. **`bulkWrite`**: cada operación del lote sigue la misma regla.
6. **`deletedBy`**: no existe. El update que marca el borrado pasa por el plugin de auditoría, que
   completa `updatedBy`, y el historial registra quién hizo qué.
7. **Papelera**: la cubren los filtros, sin métodos ni opciones extra.
8. **Índices `unique`**: se documenta `partialFilterExpression: { deletedAt: null }`, y el plugin no
   modifica índices. La unicidad se controla al escribir, así que funciona aunque las consultas
   filtren con `$exists: false`.
