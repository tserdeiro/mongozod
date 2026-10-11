# Plugins

## Contrato de plugins

El contrato sigue al de better-auth. Cada plugin tiene un `id` y se engancha a las operaciones con
hooks `before` y `after`, como los `databaseHooks` de better-auth. Para lo que necesita envolver la
operación entera, tiene un `middleware` aparte. Un plugin es una función que devuelve
`definePlugin({ … })`, para que pueda recibir su propia configuración, como los plugins de
better-auth.

```ts
import { definePlugin } from 'mongozod'
import { z } from 'zod'

export function example() {
  return definePlugin({
    // Identifies the plugin in error messages.
    id: 'example',

    // Fields the model's schema must declare, with a compatible type.
    fields: { updatedBy: z.string().optional() },

    // Options the plugin adds, one z.object per group of operations.
    options: { read: z.object({ verbose: z.boolean().optional() }) },

    // What the plugin needs from each call, per group: here, who makes a change.
    context: { update: z.object({ actor: z.string() }) },

    // Hooks by operation or by group, like better-auth's databaseHooks.
    hooks: {
      find: {
        after: ({ result }) => ({ result }),
        before: ({ args }) => ({ args })
      }
    },

    // Wraps the whole operation, for transactions or timing.
    async middleware({ next }) {
      return next()
    },

    // Methods added to the model.
    methods: {}
  })
}
```

### `id`

Identifica al plugin, como en better-auth, y aparece en los mensajes de error.

### `fields`

Es un shape de Zod con los campos que el plugin maneja. El schema del modelo tiene que declararlos
con un tipo compatible. Si no lo hace, `mongozod()` no compila y TypeScript muestra el mensaje del
plugin:

```text
softDelete needs the field "deletedAt" in the schema
softDelete needs "deletedAt" with a compatible type
```

Así, cada proyecto elige el tipo de sus campos (por ejemplo, uuid u ObjectId para `updatedBy`), y
el schema sigue describiendo el documento completo. No se llama `schema` como en better-auth porque
allá el plugin agrega campos a la base, y acá los declara el schema del modelo. Además chocaría con
el `schema` del modelo.

### `options`

Es un `z.object` por grupo de operaciones. Sus campos se suman a las opciones del driver en las
operaciones de ese grupo: con el plugin de ejemplo, `find(filter, { verbose: true })` compila y
`deleteOne(filter, { verbose: true })` no. El núcleo valida estas opciones con su schema y las quita
antes de llamar al driver.

### `context`

Es un `z.object` por grupo de operaciones con lo que el plugin necesita saber de cada llamada, como
quién hace el cambio. [Auditoría](./audit.md) lo declara solo para las escrituras:

```ts
const actor = z.object({ actor: z.uuidv4() })

/** Needs who makes the change on writes only. */
const audit = definePlugin({
  context: { delete: actor, insert: actor, update: actor },
  id: 'audit'
})
```

En los grupos donde algún plugin del modelo declara contexto, el argumento de opciones pasa a ser
obligatorio, con `context`. Vale tanto para las operaciones como para los métodos de los plugins.
En los demás grupos no existe:

```ts
await AuditedNotes.updateOne(filter, update, { context: { actor } })
await AuditedNotes.updateOne(filter, update) // error: Expected 3 arguments, but got 2
await AuditedNotes.countDocuments(filter) // reads need no context
```

En una app con services, como adsgpt, el contexto viaja dentro de las `options` que el service ya
recibe y le pasa al modelo, como hoy `input.options`. No hace falta otro parámetro ni otra firma, y
el service sigue sin conocer la sesión: el router arma el contexto, como hoy arma `scope.mutation`.
`AsyncLocalStorage` evitaría tocar las llamadas, pero se descartó porque esconde qué operaciones
necesitan contexto: una escritura sin contexto compilaría y fallaría en runtime.

### `hooks`

Van por operación (`find`, `deleteOne`…) o por grupo (`read`, `insert`, `update`, `delete`,
`bulk`), como los `databaseHooks.{modelo}.{operación}` de better-auth. Cada grupo junta las
operaciones que tienen filtro:

| Grupo    | Operaciones                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| `read`   | `find`, `findOne`, `countDocuments`, `distinct`                                  |
| `insert` | `insertOne`, `insertMany`                                                        |
| `update` | `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace` |
| `delete` | `deleteOne`, `deleteMany`, `findOneAndDelete`                                    |
| `bulk`   | `bulkWrite`                                                                      |

`aggregate` y `estimatedDocumentCount` no tienen filtro ni grupo: solo sus hooks propios y el
`middleware`. Así, [`softDelete`](./soft-delete.md) no los toca, como ya está decidido.

Un `before` ve la llamada como se escribió, antes de que el núcleo valide, complete los
[timestamps](../model.md#timestamps) o planee los virtuals y `populate`: así un plugin puede
completar un campo obligatorio, como el `createdBy` de [auditoría](./audit.md). Un `after` ve el
resultado final, el mismo que recibe quien llamó.

| Hook     | Recibe                                | Puede devolver                                                                                                                         |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `before` | `{ operation, args, context, model }` | `{ args }` para seguir con otros argumentos, `{ result }` para saltear la operación, o nada. Si lanza un error, la operación se corta. |
| `after`  | Lo mismo, más `result`                | `{ result }` para reemplazar el resultado, o nada.                                                                                     |

`model` sirve para despachar otra operación, que vuelve a pasar por todos los plugins. Así el
[soft delete](./soft-delete.md) convierte un borrado en un update, y timestamps, auditoría e
historial ven un update. Es un `AnyModel`: sus operaciones toman y devuelven `Document`, y sus
resultados admiten un `_id` de cualquier tipo.

Si un `before` devuelve `{ result }`, la operación se resuelve como en capas: no corren los
`before` de los plugins siguientes ni la operación, y sí corren los `after` del plugin que
respondió y de los anteriores. Con `[logger, softDelete, audit]`, el `after` de `logger` ve el
borrado que `softDelete` convirtió en update, y `audit` no ve un borrado que no pasó.

El `update` de una operación con `updatePipeline: true` es un pipeline, un array de etapas: un hook
que lee o cambia el update tiene que contemplarlo, por ejemplo agregando una etapa `$set` en vez de
escribir en el `$set` del update. Por eso `update` se tipa como `Document | Document[]`, y
`updatePipeline` es una opción de mongozod, que ningún plugin puede declarar.

En un hook de grupo, `args` y `result` son la unión de las operaciones del grupo. Un `before` que
solo cambia el filtro funciona tal cual, porque todas las operaciones del grupo lo tienen. Para
devolver un `result`, o argumentos propios de una operación, hay que acotar `operation`:

```ts
hooks: {
  read: {
    after({ operation, result }) {
      if (operation !== 'find') return

      return { result: result.slice(0, 100) }
    }
  }
}
```

### `middleware`

Envuelve la operación entera, para lo que tiene que estar antes y después a la vez, como una
transacción o una medición de tiempo. `next()` sigue con la operación y devuelve su resultado.
`next({ session })` además le pasa la sesión de una transacción.

```ts
/** Logs every operation of the model with its duration. */
export function logger(log: Logger) {
  return definePlugin({
    id: 'logger',

    async middleware({ model, next, operation }) {
      const started = performance.now()
      const result = await next()

      log.debug({ collection: model.name, ms: performance.now() - started, operation })

      return result
    }
  })
}
```

El [historial](./history.md) lo usa para registrar cada escritura dentro de una transacción:

```ts
async middleware({ model, next, operation }) {
  if (!WRITES.has(operation)) return next()

  return model.db.client.withSession((session) =>
    session.withTransaction(async () => {
      // Read the documents before the change with `session` (omitted).
      const result = await next({ session })

      // Read them after the change and store the record with `session` (omitted).
      return result
    })
  )
}
```

### `methods`

Se agregan al modelo. Para que tomen el tipo de documento de cada modelo, el método declara `this`
como genérico:

```ts
methods: {
  /** True when at least one document matches. */
  async exists<M extends AnyModel, const F extends FilterOf<M, F>>(
    this: M,
    filter: F,
    ...options: ReadOptionsArg<M>
  ) {
    const count = await this.countDocuments(filter, { ...options[0], limit: 1 })

    return count > 0
  }
}
```

Al llamar `NotesModel.exists(…)`, TypeScript infiere `M` desde `NotesModel`, así que el filtro es el
de `Note` y `exists({ title: 1 })` no compila. El filtro es genérico, como en las operaciones, para
chequear cada key. `...options` reenvía las opciones de la operación, `context` incluido. Si dos
plugins definen el mismo método, o uno se llama como un miembro del modelo, como `find`,
`mongozod()` no compila y lanza un `Error`: `two plugins define "exists"`.

### Reglas del contrato

- **Orden**: los plugins se aplican en capas, en el orden de la lista. El primero envuelve a los
  demás: sus `before` corren primero y sus `after`, al final. Conviene poner el logger primero, para
  que mida todo, y el historial al final, para que registre lo que llega al driver.
- **Hooks de grupo y de operación**: si un plugin define los dos para la misma operación, los
  `before` corren del grupo a la operación, de lo general a lo particular, y los `after`, al revés.
- **Validación**: el núcleo valida siempre el `context` y las opciones de los plugins con sus
  schemas. Si no cumplen, lanza un `ZodError`, con los issues del contexto en `['context', …]`.
- **Contexto**: cada plugin recibe la salida de su propio schema: si `audit` pide `{ actor }` y otro
  plugin `{ tenant }`, `audit` ve solo `{ actor }`. Quien llama manda un único `context` con todo.
  El `context` sigue en las opciones tal como se escribió, así un hook que despacha otra operación
  con `args.options` lo reenvía, y el núcleo lo quita antes de llamar al driver.
- **Opciones**: los hooks ven las opciones de los plugins ya validadas, con sus defaults y
  transforms, y el núcleo las quita antes de llamar al driver. Una opción de plugin que se llama
  como una del driver, de mongozod (`context`, `populate`, `schema`, `timestamps`) o de otro plugin
  no compila. En runtime, `mongozod()` lanza un `Error` por las de mongozod y de otros plugins: los
  nombres de las opciones del driver solo existen en sus tipos.
- **Cursores**: `find` y `aggregate` arrancan en la primera lectura, así sus `before` ven los
  modificadores del cursor (`sort`, `limit`, `skip`, `project`). Después, un modificador lanza un
  `Error`, como en el driver. Una proyección o un `populate` inválidos fallan al leer el cursor, no
  al llamar `find`.
- **Tipos auxiliares**: se exportan `AnyModel`, `DocOf<M>`, `FilterOf<M, F>`, `SortOf<M, Sort>`,
  `UpdateOf<M, U, F>`, `ReadOptionsArg<M>` y `UpdateOptionsArg<M>`, para quien escribe plugins y
  para los services que le pasan un filtro o un update al modelo:
  `countNotes<const F extends FilterOf<typeof NotesModel, F>>(filter: F)`. Parten del modelo, y
  reemplazan a `ModelFilter`, `ModelSort` y `ModelUpdate`, que partían del schema.
- **`watch`**: no pasa por los plugins y se usa con `.collection.watch()`. Los hooks corren en la
  escritura porque un change stream avisa cuando el cambio ya quedó guardado: no puede validar,
  cambiar ni cancelar la escritura, no dice quién la hizo y en un update no trae el filtro ni los
  operadores. Además necesita un replica set y una conexión abierta por stream. Un `watch` tipado
  puede sumarse más adelante, aparte de los plugins, para reaccionar a cambios ya guardados.
- **Nombres**: `definePlugin` con `id`, `fields`, `options`, `context`, `hooks`, `middleware` y
  `methods`. Los grupos son `read`, `insert`, `update`, `delete` y `bulk`.
- **Límite conocido**: los plugins ven los documentos como `Document`, así que TypeScript no detecta
  un hook que devuelve un resultado con la forma equivocada, como un `DeleteResult` en `findOne`. Lo
  cubren los tests de cada plugin. Un hook de grupo puede devolver los argumentos o el resultado de
  cualquier operación del grupo, así que el núcleo confía en que tienen el tipo de su operación.

## Plugins oficiales

Cada plugin tiene su documento, con lo que ya se sabe de él. `softDelete` tiene diseño; el resto
describe la idea y queda por diseñar. Las referencias, los virtuals y `timestamps` ya no figuran:
pasaron al [núcleo](../model.md).

| Plugin                           | Qué hace                                                                                                                     | Campos que exige         | Opciones o contexto                | Métodos    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------- | ---------- |
| [`softDelete`](./soft-delete.md) | Borrado lógico.                                                                                                              | `deletedAt`              | —                                  | —          |
| [`audit`](./audit.md)            | Completa `createdBy` y `updatedBy` desde el contexto.                                                                        | `createdBy`, `updatedBy` | Contexto `actor` en las escrituras | —          |
| [`logger`](./logger.md)          | Registra cada operación, su colección y su duración con el logger del proyecto.                                              | —                        | —                                  | —          |
| [`history`](./history.md)        | Guarda el documento antes y después, con el filtro y el update, dentro de una transacción, y permite volver atrás un cambio. | —                        | Contexto                           | `rollback` |
