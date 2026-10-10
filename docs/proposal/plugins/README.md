# Plugins

## Contrato de plugins

El contrato sigue al de better-auth. Cada plugin tiene un `id` y se engancha a las operaciones con
hooks `before` y `after`, como los `databaseHooks` de better-auth. Para lo que necesita envolver la
operación entera, tiene un `middleware` aparte. Un plugin es una función que devuelve
`definePlugin({ … })`, para que pueda recibir su propia configuración, como los plugins de
better-auth.

```ts
import { definePlugin } from '@tserdeiro/mongozod'
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
`bulk`), como los `databaseHooks.{modelo}.{operación}` de better-auth.

| Hook     | Recibe                                | Puede devolver                                                                                                                         |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `before` | `{ operation, args, context, model }` | `{ args }` para seguir con otros argumentos, `{ result }` para saltear la operación, o nada. Si lanza un error, la operación se corta. |
| `after`  | Lo mismo, más `result`                | `{ result }` para reemplazar el resultado, o nada.                                                                                     |

`model` sirve para despachar otra operación, que vuelve a pasar por todos los plugins. Así el
[soft delete](./soft-delete.md) convierte un borrado en un update, y timestamps, auditoría e
historial ven un update.

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
  async exists<M extends AnyModel>(this: M, filter: FilterOf<M>, ...options: ReadOptionsArg<M>) {
    const count = await this.countDocuments(filter, { ...options[0], limit: 1 })

    return count > 0
  }
}
```

Al llamar `NotesModel.exists(…)`, TypeScript infiere `M` desde `NotesModel`, así que el filtro es el
de `Note` y `exists({ title: 1 })` no compila. `...options` reenvía las opciones de la operación,
`context` incluido. Si dos plugins definen el mismo método, `mongozod()` tampoco compila:
`two plugins define "exists"`.

### Reglas del contrato

- **Orden**: los plugins se aplican en capas, en el orden de la lista. El primero envuelve a los
  demás: sus `before` corren primero y sus `after`, al final. Conviene poner el logger primero, para
  que mida todo, y el historial al final, para que registre lo que llega al driver.
- **Hooks de grupo y de operación**: si un plugin define los dos para la misma operación, los
  `before` corren del grupo a la operación, de lo general a lo particular, y los `after`, al revés.
- **Validación**: el núcleo valida siempre el `context` y las opciones de los plugins con sus
  schemas compilados. Si no cumplen, lanza un `ZodError`.
- **Tipos auxiliares**: se exportan `AnyModel`, `DocOf`, `FilterOf`, `ReadOptionsArg` y
  `UpdateOptionsArg` para quien escribe plugins.
- **`watch`**: no pasa por los plugins y se usa con `.collection.watch()`. Los hooks corren en la
  escritura porque un change stream avisa cuando el cambio ya quedó guardado: no puede validar,
  cambiar ni cancelar la escritura, no dice quién la hizo y en un update no trae el filtro ni los
  operadores. Además necesita un replica set y una conexión abierta por stream. Un `watch` tipado
  puede sumarse más adelante, aparte de los plugins, para reaccionar a cambios ya guardados.
- **Nombres**: `definePlugin` con `id`, `fields`, `options`, `context`, `hooks`, `middleware` y
  `methods`. Los grupos son `read`, `insert`, `update`, `delete` y `bulk`.
- **Límite conocido**: los plugins ven los documentos como `Document`, así que TypeScript no detecta
  un hook que devuelve un resultado con la forma equivocada, como un `DeleteResult` en `findOne`. Lo
  cubren los tests de cada plugin.

## Plugins oficiales

Cada plugin tiene su documento, con lo que ya se sabe de él. `softDelete` tiene diseño y
`timestamps`, su alcance; el resto describe la idea y queda por diseñar. Las referencias y los
virtuals ya no figuran: pasaron al [núcleo](../model.md).

| Plugin                           | Qué hace                                                                                                                     | Campos que exige                                          | Opciones o contexto                                            | Métodos    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| [`timestamps`](./timestamps.md)  | Completa `createdAt` al insertar (en un upsert, con `$setOnInsert`) y `updatedAt` en cada escritura.                         | `createdAt`, `updatedAt`, con otro nombre si se configura | Los nombres de los campos, y `timestamps: false` por operación | —          |
| [`softDelete`](./soft-delete.md) | Borrado lógico.                                                                                                              | `deletedAt`                                               | —                                                              | —          |
| [`audit`](./audit.md)            | Completa `createdBy` y `updatedBy` desde el contexto.                                                                        | `createdBy`, `updatedBy`                                  | Contexto `actor` en las escrituras                             | —          |
| [`logger`](./logger.md)          | Registra cada operación, su colección y su duración con el logger del proyecto.                                              | —                                                         | —                                                              | —          |
| [`history`](./history.md)        | Guarda el documento antes y después, con el filtro y el update, dentro de una transacción, y permite volver atrás un cambio. | —                                                         | Contexto                                                       | `rollback` |
