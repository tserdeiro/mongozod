# Adapter de Better Auth

Estado: implementado el 2026-11-26, en `packages/mongozod/src/adapters/better-auth/`, con Better
Auth 1.7.28 y MongoDB 8.2.6 (ver [Qué se verificó](./verified.md)). Lo que se decidió al
implementarlo está en [Decisiones al implementar](#decisiones-al-implementar).

## Objetivo

Un adapter de base de datos para [Better Auth](https://www.better-auth.com) que hace pasar sus
lecturas y escrituras por los modelos de mongozod, así los plugins del modelo (`softDelete`,
`timestamps`, los propios) se aplican también a las operaciones de Better Auth. Se importa de
`mongozod/adapters/better-auth`.

Los modelos sobre las colecciones de Better Auth ya se usan fuera de él, por ejemplo para
`aggregate`, como cualquier otro modelo. El adapter suma que Better Auth escriba y lea a través de
ellos.

El caso que lo motiva: al borrar una cuenta, `users` y `organizations` se marcan con
`softDelete`, y cuando el mismo email se registra de nuevo, la organización se restaura con su id,
que es el App User ID de RevenueCat, así el cliente conserva su historial.

## API

```ts
import { betterAuth } from 'better-auth'
import { mongozodAdapter } from 'mongozod/adapters/better-auth'

export const auth = betterAuth({
  database: mongozodAdapter({
    db,
    // Enables transactions, like the official adapter.
    client,
    // Keyed by Better Auth table: these go through their model, and its plugins run.
    models: { organization: OrganizationsModel, user: UsersModel }
  })
})
```

- **`db`**: el `Db` del driver, para las tablas sin modelo.
- **`client`**: el `MongoClient`. Con él, el adapter usa transacciones, como el oficial; sin él,
  `transaction` es `false` y Better Auth corre las operaciones en orden.
- **`models`**: los modelos de mongozod, por el nombre de la tabla en Better Auth (`user`,
  `organization`, `member`…).

El subpath también exporta `transactionSession()`, la sesión de la transacción en curso para el
código que corre dentro de ella, como un hook (ver [Restaurar](#restaurar)), y
`toAdditionalFields()`, que arma los `additionalFields` de Better Auth desde el schema del modelo
(ver [`toAdditionalFields`](#toadditionalfields)).

Se arma con `createAdapterFactory` de `better-auth/adapters`, como dice la guía
[Create a database adapter](https://www.better-auth.com/docs/guides/create-a-db-adapter).
`better-auth` es una peer dependency opcional, `^1.7.0`: la 1.7 agrega `consumeOne` e
`incrementOne`.

## Ruteo

Cada tabla de Better Auth va por su modelo si `models` lo tiene, o por la colección del driver si
no. Las tablas con modelo suelen ser pocas, como `user` y `organization`; el resto, como `session`,
`account`, `verification`, `jwks` o las de OAuth, va por el driver, igual que en el adapter
oficial.

El adapter tiene **una sola implementación**: los métodos de un modelo de mongozod tienen los
mismos nombres y firmas que los de una `Collection` del driver (`findOne`, `find`, `insertOne`,
`findOneAndUpdate`, `countDocuments`…), así que cada operación recibe el modelo o la colección y
hace lo mismo con cualquiera de los dos. La traducción del `where`, los ids, las transacciones,
`consumeOne` e `incrementOne` se escriben una vez.

Es una implementación propia, no una capa sobre `@better-auth/mongo-adapter`: el oficial abre la
`session` de la transacción adentro de su `transaction`, y los modelos tienen que recibir la misma;
y crea sus índices con todas las tablas de Better Auth, también las que tienen modelo.

## Operaciones

| Better Auth    | Modelo o colección                                                                    |
| -------------- | ------------------------------------------------------------------------------------- |
| `create`       | `insertOne`, y devuelve el documento con su `_id`                                     |
| `findOne`      | `findOne`, con `projection` por `select`                                              |
| `findMany`     | `find`, con `projection`, `sort`, `skip` y `limit`                                    |
| `count`        | `countDocuments`                                                                      |
| `update`       | `findOneAndUpdate` con `$set` y `returnDocument: 'after'`                             |
| `updateMany`   | `updateMany` con `$set`, y devuelve `modifiedCount`                                   |
| `delete`       | `deleteOne`                                                                           |
| `deleteMany`   | `deleteMany`, y devuelve `deletedCount`                                               |
| `consumeOne`   | `findOneAndDelete`, que borra y devuelve en un paso                                   |
| `incrementOne` | `findOneAndUpdate` con `$inc` y `$set`, con el `where` como selector y como condición |

Las lecturas usan `findOne`, `find` y `countDocuments`, no `aggregate` como el adapter oficial,
porque así corren los hooks `read` de los plugins del modelo, como el filtro de `softDelete`.

### `where`

La traducción sigue a la del adapter oficial:

- **Operadores**: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in` (`$in`), `not_in` (`$nin`),
  `contains`, `starts_with` y `ends_with`, estos tres con `$regex` sobre el valor escapado.
- **`mode: 'insensitive'`**: en los strings, igualdad, `in`, `not_in`, `ne` y los tres de patrón
  con `$regex` y `$options: 'i'`. No se aplica al `id` ni a las referencias.
- **Conectores**: una sola condición va sola. Con varias, las `AND` van juntas en un `$and` y las
  `OR` en un `$or`, los dos en el mismo filtro.
- **`id`**: `id` ↔ `_id` con `mapKeysTransformInput` y `mapKeysTransformOutput`.

### Ids

Como el adapter oficial: con `advanced.database.generateId` como función, el id pasa tal cual,
como los UUID en string de adsgpt; si no, `customIdGenerator` arma el id con
`new ObjectId().toString()`, y los ids y las referencias a `id` se guardan como `ObjectId` (o `UUID`
con `generateId: 'uuid'`) y se leen como string, con `customTransformInput` y
`customTransformOutput`. Un schema con `_id` como `mz.objectId()` toma el `ObjectId` que arma la
transformación, y el signup y el login funcionan con él.

### Joins

- **`advanced.database.joins` apagado**, el default: Better Auth resuelve cada join con un
  `findOne` o un `findMany` del adapter sobre la tabla unida, así que el join ya pasa por el modelo
  de esa tabla y por sus plugins.
- **Encendido**: el adapter resuelve el join de la misma forma, con una consulta por tabla unida
  a través del modelo o la colección, sin `$lookup`. Es el mismo criterio que
  [`populate`](./model.md#referencias): un documento unido pasa por los plugins de su modelo, así
  un documento borrado no aparece en un join. Con el prototipo, el `user` de una `session` unida
  vuelve como `null` después de borrar el usuario.

### Transacciones

Como en el oficial, las transacciones se activan con `client`. Sin él funciona en cualquier
servidor; con él, en uno standalone el signup falla con el error 20 (`IllegalOperation`,
«Transaction numbers are only allowed on a replica set member or mongos»), porque MongoDB solo
tiene transacciones en un replica set o un cluster.

Con `client`, `transaction` abre una sesión, corre el callback con `withTransaction` y le pasa la
`session` a cada operación, del modelo o de la colección. Como en el oficial, el callback puede
correr más de una vez si MongoDB aborta la transacción por un conflicto de escritura; Better Auth
corre sus hooks `after` una sola vez, después del commit.

Un modelo cuyo `db` es de otro `MongoClient` no recibe un chequeo propio: dentro de una
transacción, el driver ya lanza `MongoInvalidArgumentError` («ClientSession must be from the same
MongoClient»), y fuera de ella no hay sesión que compartir.

## Índices

- **Tablas sin modelo**: el adapter crea los mismos índices que el oficial, con las mismas reglas:
  uno único por cada campo `unique` y uno por cada campo `index` de Better Auth, con sus nombres
  (`session_token_uidx`, `session_userId_idx`…), los parciales de los campos únicos opcionales y
  los `indexes` de las tablas de los plugins. Si uno falla, lo informa en el log y sigue, como el
  oficial. Es la parte que se copia del oficial; para no quedar atrás, la
  [suite de Better Auth](#tests) corre en el CI con cada versión nueva, y se le propone a Better
  Auth exportar esa lógica, con un issue.
- **Tablas con modelo**: el adapter no crea índices. Los declara el modelo en `indexes` y los crea
  [`sync()`](./model.md#sincronización) o `autoIndex`. Así un índice único de una colección con
  `softDelete` lleva `partialFilterExpression: { deletedAt: null }`, como dice la
  [decisión 8 del soft delete](./plugins/soft-delete.md#decisiones-del-soft-delete): `user.email`
  es `unique` en Better Auth, y un índice único completo no dejaría registrarse de nuevo a un email
  borrado.

## Schema

El schema del modelo es estricto: tiene que declarar cada campo que Better Auth escribe en esa
tabla, también los de sus plugins (como `organization` o `admin`) y los `additionalFields`. La
factory le pasa al adapter el `schema` de Better Auth con los campos de cada tabla; al crearse, el
adapter chequea que el schema de cada modelo tenga cada uno de esos campos, con su `fieldName`, y
si falta alguno lanza un `Error` que nombra la tabla y los campos, como las demás configuraciones
inválidas.

El chequeo va en un sentido: los campos que agregan los plugins del modelo, como el `deletedAt` de
`softDelete`, no están en el schema de Better Auth, que no los escribe. Better Auth tampoco ve los
campos que solo maneja la app: sus lecturas devuelven solo los campos de su schema, y su signup
toma del body solo los de `additionalFields`. Por eso un campo del modelo que Better Auth no
conoce es opcional o tiene un `.default()`: si es obligatorio, cada signup lanza un `ZodError`.

### `toAdditionalFields`

Un campo que Better Auth tiene que ver, como un `role` que lee la sesión, va en su
`additionalFields`. `toAdditionalFields` lo arma desde el schema del modelo, así no se escribe dos
veces:

```ts
import { toAdditionalFields } from 'mongozod/adapters/better-auth'

export const auth = betterAuth({
  user: {
    additionalFields: toAdditionalFields(UsersModel, {
      joinedAt: { input: false },
      phone: true,
      role: true
    })
  }
})
```

- **El nombre** sigue a `z.toJSONSchema()` de Zod, que también convierte un schema a otro formato.
- **La máscara** nombra los campos, como el `.pick()` de Zod: `true`, o las opciones de Better Auth
  que no salen del schema (`input: false`, `returned: false`). Los campos se eligen porque
  `additionalFields` se aplica después de los de Better Auth y de sus plugins, y los reemplaza: un
  `email` perdería su `unique`, y un `role` del plugin `admin`, su `input: false`, que impide
  registrarse como admin. Los campos de Better Auth no van en la máscara.
- **El tipo** sale del campo: `string`, `number`, `boolean`, `date`, `string[]` y `number[]`, un
  `z.enum` como el array de sus valores, y el resto como `json`, que Better Auth tipa como
  `Record<string, any>`.
- **`required`** es `false` si el campo es opcional o acepta `null`. Un `.default()` pasa como
  `defaultValue`, que se calcula en cada signup.
- **`validator.input`** es el schema del campo, una opción documentada de Better Auth que toma
  cualquier Standard Schema: Better Auth valida el input con las mismas reglas que el modelo.

Se verificó con un prototipo: `auth.$Infer.Session.user` tiene el tipo exacto de cada campo (el
enum, el default como obligatorio, el opcional con `null` y `undefined`), y el body de
`signUpEmail` exige los obligatorios y rechaza un valor fuera del enum y un campo con
`input: false`. Su costo de tipos se mide con `pnpm check-type-cost` al implementarlo.

Better Auth escribe `Date`, booleanos y arrays nativos (`supportsDates`, `supportsBooleans` y
`supportsArrays`, como el oficial), y completa `createdAt` y `updatedAt` él mismo, así que un
modelo de una tabla de Better Auth no usa [`timestamps`](./model.md#timestamps).

## Tipos

- **La inferencia de Better Auth no depende del adapter**: `database` toma un `DBAdapterInstance`,
  y `auth.$Infer` y `auth.api` salen de las demás opciones. Con el prototipo, el `role` de un
  `additionalFields` se infiere como su enum, la API de `organization()` está tipada, y sin
  `additionalFields` no hay `role`.
- **`models`** es un `Partial<Record<string, AnyModel>>`: un modelo con `softDelete` entra sin
  casts. `AnyModel` es el tipo con el que los plugins ven un modelo.
- **Una implementación para los dos caminos**: una interfaz interna con los métodos que usa el
  adapter acepta tanto la `Collection<Document>` del driver como `AnyModel`, si su `insertOne`
  devuelve `{ insertedId }`; el `document` que suma el del modelo se lee con `'document' in result`.

## Contexto

Las llamadas de Better Auth no traen el `context` de mongozod, así que un modelo con un plugin que
pide contexto, como el futuro [`audit`](./plugins/audit.md), no funciona con el adapter: sus
escrituras lanzan el `ZodError` del contexto. La opción `context` se agrega cuando exista un plugin
oficial que lo pida. Se verificó que, desde adentro del adapter,
`tryGetCurrentAuthEndpointContext()` de `@better-auth/core/context` da el `path` de la request y,
una vez resuelta, su sesión; no está en la documentación de Better Auth y obliga a tener
`@better-auth/core` como peer dependency.

## `softDelete` a través del adapter

- **Borrar**: el `delete` y el `deleteMany` de Better Auth sobre una tabla con `softDelete` marcan
  `deletedAt`, porque el plugin convierte el borrado en un update. Al borrar un usuario, Better
  Auth borra sus sesiones y sus cuentas y después el usuario; las tablas sin modelo se borran de
  verdad.
- **Leer**: las lecturas no ven los documentos borrados, así que un email borrado se registra como
  nuevo.
- **Sin receta**, un email borrado que se registra de nuevo crea otro usuario, con otro id, y el
  borrado queda en la colección.

### Restaurar

`databaseHooks.user.create.before` puede devolver `{ data }`, que Better Auth combina con los datos
y crea con `forceAllowId: true`, así el usuario nuevo toma el id del borrado. El hook busca el
usuario borrado por email, lo borra de verdad (con un filtro que menciona `deletedAt`, que libera
el `_id`) y devuelve `{ data: { id } }`. Las organizaciones se restauran en el mismo hook, con un
update cuyo filtro menciona `deletedAt`: un hook `after` corre después del commit, fuera de la
transacción.

El signup corre en una transacción, y el hook tiene que usar su `session`. Con ella, el prototipo
restaura el id, y si un paso posterior falla, el rollback deshace el borrado. Sin ella, con el
modelo directo o con `ctx.context.adapter`, el insert de Better Auth da clave duplicada, porque la
transacción no ve el borrado, y un fallo posterior deja el usuario borrado perdido.
`ctx.context.adapter`, además, solo acepta campos del schema de Better Auth: `deletedAt` tendría que
declararse en `additionalFields`.

Un hook tampoco puede abrir su propia transacción: sería otra, que se confirma aparte, y el insert
de Better Auth da la misma clave duplicada. MongoDB no anida transacciones, así que el hook se suma
a la del signup.

`mongozod/adapters/better-auth` exporta `transactionSession()`, que devuelve la `ClientSession` de
la transacción de Better Auth en curso, o `undefined` fuera de una. El adapter la guarda en un
`AsyncLocalStorage` mientras corre el callback de `transaction`, y el hook la pasa como cualquier
`session` del driver, a la vista en cada operación:

```ts
import { transactionSession } from 'mongozod/adapters/better-auth'

export const auth = betterAuth({
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const session = transactionSession()

          // With `client`, the sign up runs in a transaction.
          if (!session) return undefined

          const deleted = await UsersModel.findOne(
            { deletedAt: { $exists: true }, email: user.email },
            { session }
          )

          if (!deleted) return undefined

          await UsersModel.deleteOne({ _id: deleted._id, deletedAt: { $exists: true } }, { session })
          // Restore the user's organizations here too, with the same session.

          return { data: { ...user, id: deleted._id } }
        }
      }
    }
  }
})
```

Es el estilo de `txHost.tx` de nestjs-cls, que devuelve la transacción del contexto.

## Tests

- **La suite de Better Auth**: `testAdapter` de `@better-auth/test-utils/adapter`, con las suites
  que corre el oficial en su repo (`e2e/adapter/test/mongo-adapter` de la 1.7.28):
  `normalTestSuite`, `authFlowTestSuite`, `caseInsensitiveTestSuite`, `joinsTestSuite`,
  `transactionsTestSuite` y `uuidTestSuite`. Sus suites propias de índices y de `ObjectId` no están
  en `@better-auth/test-utils`, así que esos casos van entre los tests propios. Corre sin
  `models`, por el camino del driver: sus tests cambian las opciones mientras corren
  (`additionalFields`, `modelName`), y un schema estricto no los acepta.
- **Los propios**, por el camino de los modelos: el ruteo, la traducción del `where`, el chequeo
  del schema, las transacciones con tablas de los dos caminos, los joins, y `softDelete` al borrar,
  leer y restaurar.
- **`toAdditionalFields`**: los tipos que infiere Better Auth, con tests de tipos, y el signup con
  los defaults y la validación del schema.

## Documentación

Una página en `packages/docs`, `adapters/better-auth.md`, con la configuración, el ruteo, el
schema, `toAdditionalFields`, los índices de las colecciones con `softDelete`, las transacciones y
la receta para restaurar, y los errores comunes. La carpeta se llama como el subpath, `adapters/`, igual que `plugins/`, así
la URL es `mongozod.dev/docs/adapters/better-auth`.

## Decisiones al implementar

- **Opciones**: `db`, `client` y `models`, las acordadas. `models` sugiere en el editor las tablas
  de Better Auth (`user`, `session`, `account`, `verification`) y acepta cualquier otra, como las
  de sus plugins.
- **El chequeo de los modelos** corre cuando Better Auth crea el adapter, en su primera operación:
  `auth.$context` lo rechaza con el `Error`. Una key de `models` que no es una tabla de Better Auth
  también lanza un `Error`.
- **Los tipos de `CustomAdapter`**: Better Auth tipa los resultados con un argumento de tipo de
  quien llama (`findOne<T>()`), como en cada adapter. Los métodos lo declaran con un overload, sin
  casts.
- **Una consulta a la vez**: los joins y los documentos de un `findMany` con joins se leen en
  orden, porque las operaciones de una transacción comparten su sesión.
- **Los índices** de las tablas sin modelo toman los nombres y las columnas de Better Auth, con su
  hash para los nombres largos; los chequeos de portabilidad que Better Auth hace para las
  migraciones SQL no se repiten. Los errores se informan con `createLogger(options.logger)` de
  `better-auth`, así respetan el logger de la app.
- **Una transacción que se repite**: `withTransaction` corre de nuevo el callback cuando MongoDB
  aborta la transacción por un error transitorio, como un conflicto con un índice que se crea al
  arrancar. Better Auth corre entonces otra vez el request, y en un signup manda dos cookies de
  sesión: vale la última, como en un navegador.
- **`transactionSession()` con `exactOptionalPropertyTypes`**: devuelve `ClientSession | undefined`,
  y `{ session: transactionSession() }` no compila con esa opción, como cualquier `session`
  opcional del driver. El hook lo resuelve con un `if (!session)`, que con `client` nunca se cumple
  dentro de una transacción de Better Auth.
- **Los índices al arrancar y las transacciones**: el adapter crea los índices de las tablas sin
  modelo al crearse, sin esperar, como el oficial. Si el primer signup escribe en una de esas
  colecciones mientras su índice se crea, MongoDB aborta la transacción por el cambio de catálogo,
  y si Better Auth envuelve el error, no se reintenta: ese signup falla una vez. Les pasa igual a
  los dos adapters. La suite de Better Auth corre sin `client`, como la del oficial, y los tests
  propios crean los índices una vez antes de las transacciones.
- **Los índices y las transacciones**: el adapter de una transacción no crea ni espera índices.
  Una creación de índices toma el lock exclusivo de la colección, que espera a que termine una
  transacción que la leyó o la escribió, y la transacción esperaba a la creación: el registro de un
  cliente OAuth (`/oauth2/register`, que lee y escribe `oauthClientResource` en una transacción) se
  colgaba hasta que vencía la transacción. Los índices de tabla de las tablas sin modelo empiezan a
  crearse al crearse el adapter, como los de campo, y una escritura fuera de una transacción los
  espera, como el oficial. Lo encontró la migración de AdsGPT.
- **Los campos `json`** se guardan como valores (`supportsJSON: true`), como guarda MongoDB
  cualquier objeto: es lo que el contrato de Better Auth declara para una base con JSON nativo, y
  el schema de un modelo los toma como un `z.object()`. El adapter oficial deja la opción en su
  default, `false`, y los guarda como texto, igual que mongozod 0.6. Por retrocompatibilidad, el
  adapter lee un campo `json` guardado como texto como su valor, con el mismo parseo que Better Auth
  hace con el default (`safeJSONParse`, que también convierte las fechas ISO en `Date`), y una
  escritura del campo lo guarda como valor: nadie corre una migración. Un string que no es JSON queda
  como está, en vez del `null` de Better Auth, para no perder un valor guardado. `safeJSONParse` es
  de `@better-auth/core`, que mongozod no tiene como dependencia: el parseo va inline. Los
  campos `json` son de los plugins, como la `metadata` y los `customClaims` de `oauth-provider`, y
  de los `additionalFields`; la `metadata` de `organization` es un `string` que el plugin serializa,
  y no cambia. Lo encontró AdsGPT con los `utms` del usuario: con el default, el modelo recibía el
  texto y su `z.object()` lo rechazaba.
- **Los errores** son `Error` sin clases propias: un id inválido y un operador que no existe.
