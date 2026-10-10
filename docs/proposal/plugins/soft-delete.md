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
  despachados por el modelo, así [`timestamps`](../model.md#timestamps), [auditoría](./audit.md) e
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

Vive en `packages/mongozod/src/plugins/soft-delete.ts`. La regla y los hooks:

```ts
/** Without `deletedAt`. Unlike `deletedAt: null`, an upsert does not copy it into the new document. */
const NOT_DELETED = { deletedAt: { $exists: false } }

/** Adds the soft delete condition, unless the caller's filter already decides about `deletedAt`. */
function excludeDeleted(filter: Document = {}): Document {
  if (mentionsDeletedAt(filter)) return filter

  return { $and: [filter, NOT_DELETED] }
}

export function softDelete() {
  return definePlugin({
    fields: { deletedAt: z.date().optional() },
    hooks: {
      bulkWrite: {
        before: ({ args }) => ({
          args: { ...args, operations: args.operations.map(bulkOperation) }
        })
      },
      deleteOne: {
        async before({ args, model }) {
          if (mentionsDeletedAt(args.filter)) return undefined

          const result = await model.updateOne(args.filter, mark(), args.options)

          return {
            result: { acknowledged: result.acknowledged, deletedCount: result.modifiedCount }
          }
        }
      },
      // deleteMany: the same with updateMany. findOneAndDelete: findOneAndUpdate, returnDocument 'before'.
      read: { before: ({ args }) => ({ args: { ...args, filter: excludeDeleted(args.filter) } }) },
      update: { before: ({ args }) => ({ args: { ...args, filter: excludeDeleted(args.filter) } }) }
    },
    id: 'softDelete'
  })
}
```

El update que marca el borrado recibe las opciones del borrado tal como se escribieron, `context`
incluido, así los demás plugins lo ven como cualquier update.

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
   filtren con `$exists: false`: un documento borrado libera su clave. app-maker pone `deletedAt` en
   la clave de cuatro índices únicos porque su comentario dice que un índice parcial no puede
   expresar «sin `deletedAt`»; `deletedAt: null` sí lo expresa.
9. **`bulkWrite`, lo que cuenta**: los documentos marcados cuentan en `matchedCount` y
   `modifiedCount`, como informa el driver, y `deletedCount` cuenta solo los borrados reales. El
   resultado sigue siendo el `BulkWriteResult` del driver, con sus métodos.
10. **Contexto**: como un borrado se convierte en un update, un plugin que pide contexto en los
    updates tiene que pedirlo también en los borrados, como [auditoría](./audit.md) en todas las
    escrituras. Si no, un borrado compila sin contexto y el update que despacha lanza un `ZodError`.
11. **`count`**: `countDocuments` y `distinct` también excluyen los borrados. Hoy el `count` de
    adsgpt y wortise-dashboard-monorepo los cuenta (un test de adsgpt lo fija), así que al migrar un
    conteo puede bajar.
