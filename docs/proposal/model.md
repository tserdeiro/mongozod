# El modelo

```ts
import { mongozod } from 'mongozod'
import { softDelete } from 'mongozod/plugins/soft-delete'

export const NotesModel = mongozod({
  schema: noteSchema,
  collection: 'notes',
  db: () => client.db(),
  indexes: (index) => [index({ organization: 1, createdAt: -1 })],
  plugins: [softDelete()]
})
```

- **`schema`**: un `z.object`, o una `z.discriminatedUnion` de objetos, de Zod o de Zod Mini, que
  describe el documento tal como se guarda. Con una unión, la colección guarda varios tipos de
  documento. El `_id` se genera con su `.default()`, como
  `z.uuidv4().default(() => crypto.randomUUID())`, que conviene definir una vez y reusar. Si el
  schema no lo declara, el driver genera un ObjectId.
- **`collection`**: el nombre de la colección.
- **`db`**: un `Db` del driver o una función que lo devuelve, que se resuelve en la primera
  operación. Así el modelo se puede definir al importar el módulo aunque la conexión dependa del
  entorno, como en los tests con `mongodb-memory-server`. Desde el `Db` se llega al cliente
  (`db.client`), que hace falta para sesiones y transacciones.
- **`indexes`**: los índices que crea `sync()`, con las claves tipadas contra el schema. Ver
  [Sincronización](#sincronización).
- **`jsonSchema`**: aplica en `sync()` un `$jsonSchema` generado desde el schema. Ver
  [Sincronización](#sincronización).
- **`plugins`**: los plugins del modelo, en el orden en que se aplican.
- **`references`**: los campos que guardan el `_id` de otro documento, que `populate` reemplaza
  por el documento. Ver [Referencias](#referencias).
- **`timestamps`**: completa `createdAt` y `updatedAt`. Ver [Timestamps](#timestamps).
- **`virtuals`**: campos calculados a partir de otros, que no se guardan. Ver [Virtuals](#virtuals).

El modelo expone `.schema`, `.collection` (el `Collection` tipado del driver), `.db`, `.name` y
`.virtuals`. Además tiene las operaciones, `sync()` y los métodos de sus plugins.

## Timestamps

Completan `createdAt` al insertar (en un upsert, con `$setOnInsert`) y `updatedAt` en cada
escritura. Son una opción de `mongozod()`, no un plugin, como en Mongoose: `timestamps: true`, o un
objeto por campo. Está apagada por defecto.

- **Solo `createdAt` y `updatedAt`**, como en Mongoose: son las únicas fechas que tiene cualquier
  documento. Las demás son eventos del dominio, como `approvedAt` o `syncedAt`, y `deletedAt` es de
  [`softDelete`](./plugins/soft-delete.md).
- **Configurables**: cada una se puede renombrar o apagar, como
  `{ createdAt: 'created_at', updatedAt: false }` en una colección cuyos documentos no cambian.
- **En el schema**: los campos se declaran en el schema, que sigue siendo la única fuente de verdad,
  y siguen a la opción, renombrados o apagados. Tienen que estar en todos los tipos de documento y
  tomar y devolver una `Date`. Si no, `mongozod()` no compila, y en runtime lanza un `Error`.
- **Sin `.default()`**: el schema declara
  lo que se guarda, y mientras `timestamps` está activo el tipo del insert y del reemplazo los deja
  opcionales, porque el núcleo los completa antes de validar. Así funciona la opción de Mongoose,
  que agrega los campos sola. Un `.default()` sigue funcionando. El tipo infiere de las opciones si
  la operación pasa `timestamps: false`, en vez de usar un overload: así sigue rechazando una opción
  mal escrita. La forma documentada es
  [`date()`](./inputs.md#decisiones-de-los-inputs), de `mongozod/codecs/date`, que acepta una
  `Date` o un ISO, para los inputs que llegan en JSON, y devuelve una `Date`:

  ```ts
  import { date } from 'mongozod/codecs/date'

  const noteSchema = z.object({ title: z.string(), createdAt: date(), updatedAt: date() })
  ```

  Sirve para las demás fechas, como `deletedAt` o `scheduledFor`.

- **Inserts y reemplazos**: como Mongoose, `createdAt` es el que viene o «ahora»; adsgpt guarda en
  `brands` la fecha de la fuente. `updatedAt` es el que viene o el valor de `createdAt`, así un
  documento sin cambios tiene las dos iguales y nada se descarta en silencio. «Ahora» es un
  `new Date()` por operación: todos los documentos de un `insertMany` tienen la misma fecha.
- **Updates**: `updatedAt` va en `$set` y, en un upsert, `createdAt` va en `$setOnInsert`, como en
  Mongoose. En un upsert, `updatedAt` es la fecha de la escritura, porque `$set` y `$setOnInsert` no
  pueden escribir el mismo campo. Un [pipeline](./types.md#updates) recibe una última etapa `$set`
  con las dos fechas, `createdAt` con `$ifNull` y solo en un upsert.
- **Escribirlos**: un update que escribe `updatedAt`, o `createdAt` fuera de `$setOnInsert`, no
  compila y lanza un `ZodError`: `"updatedAt" is set by timestamps: pass timestamps: false to write
  it`. Mongoose los descarta o pisa en silencio. `$setOnInsert` sí puede dar `createdAt`, que es la
  fecha de creación de un upsert, como en un insert.
- **Por operación**: una operación puede saltearlos con la opción `timestamps: false`, como en
  Mongoose; sus campos vuelven a ser campos comunes, que se pueden escribir para corregirlos. Un
  insert o un reemplazo con `timestamps: false` pide las fechas, salvo que el schema les dé un
  `.default()`; si faltan, no compila, y en runtime el schema lanza un `ZodError`. En
  `bulkWrite` va en las opciones de la llamada y vale para todas sus operaciones. Solo existe en los
  modelos con timestamps, y mongozod la quita antes de llamar al driver.
- **Borrados**: un borrado de `softDelete` es un update, así que también completa `updatedAt`.

## Sincronización

`sync()` prepara la colección en el servidor: aplica el `$jsonSchema` si el modelo lo pide y crea
los índices declarados. Es explícito, para correr al desplegar o desde un script, y no en cada
operación. Está a prueba: si resulta repetitivo o fácil de olvidar, se cambia.

```ts
export const PluginsModel = mongozod({
  schema: pluginSchema,
  collection: 'plugins',
  db,
  indexes: (index) => [index({ organization: 1, plugin: 1 }, { unique: true })],
  jsonSchema: true
})

const { extraIndexes } = await PluginsModel.sync()
```

- **Índices**: un callback que declara cada uno con `index(key, options)`, como el
  `createIndex(key, options)` del driver y el `schema.index(fields, options)` de Mongoose. Las
  opciones son las del `IndexDescription` del driver (`unique`, `partialFilterExpression`, `name`,
  `expireAfterSeconds`…), y cada `index()` devuelve uno. adsgpt y wortise-dashboard-monorepo los
  declaran como `{ key, options }`; wortise se los pasa así al driver, que descarta `options`, así
  que el `unique` de waitlists nunca se creó.
- **Por qué un callback**: así el editor sugiere los paths. Con un array, como
  `[{ key, unique }]`, el schema y los índices se infieren del mismo objeto, y mientras se escribe
  el array TypeScript no tiene con qué completar; tampoco con `mongozod(schema, { indexes })` ni con
  un callback que devuelve el array. TypeScript chequea el callback después de fijar el schema, y
  cada `index()` se tipa por separado, como un `find()`.
- **Tipos**: cada clave es un path del documento, con punto y a través de arrays, como en un filtro,
  o un comodín (`$**`, `path.$**`), con los valores del driver: 1, -1, `'text'`, `'2dsphere'`… El
  `partialFilterExpression` se chequea como el filtro del modelo; el servidor rechaza los operadores
  que no acepta un índice parcial, como `$ne` (código 67). En runtime, una clave que no es un path
  lanza un `Error` al definir el modelo.
- **Nunca borra un índice**, a diferencia del `syncIndexes()` de Mongoose. Uno existente que difiere
  del declarado falla con el error del servidor, que lo nombra: 85 con la misma clave y otro nombre,
  86 con el mismo nombre y otras opciones. `createIndexes` es atómico, así que no se crea ninguno.
  Un índice con otro nombre y otras opciones sí se crea, y el viejo queda entre los que sobran.
- **Lo que devuelve**: `{ indexes, extraIndexes }`, los nombres de los declarados, creados o ya
  existentes, y los índices que la colección tiene y el modelo no declara, salvo el del `_id`. El
  script que lo llama decide si los loguea: la librería no escribe en la consola.
- **`jsonSchema`**: `true` aplica `validationLevel: 'strict'` y `validationAction: 'error'`, los
  defaults de MongoDB, y también acepta `{ validationLevel: 'moderate' }`, que no valida los updates
  de documentos que ya no pasan, para migrar colecciones con datos. Se aplica con `collMod`, o al
  crear la colección si no existe. Si el modelo no lo pide, `sync()` no toca el validador que tenga
  la colección.
- **Qué genera**: la estructura, lo que la app no puede chequear (un `$set` con punto que crea
  padres, un índice que rellena con `null`) y lo que se escribe por fuera del modelo: el tipo BSON de
  cada campo, los obligatorios, objetos y arrays anidados, enums y literales, `null` y las uniones
  con `anyOf`. Sigue la salida del schema, que es lo que se guarda: el final de un pipe o de un
  codec. Los refinements quedan en la app; los transforms, `z.custom`, `z.unknown` y los schemas
  recursivos, sin regla, porque MongoDB no tiene `$ref`. La excepción es el
  [`objectId()`](./inputs.md#decisiones-de-los-inputs) de `mongozod/codecs/bson`, que es un
  `objectId`.
- **Campos de más**: un `z.object` común descarta las keys que no declara, pero los documentos
  viejos pueden tenerlas, así que `additionalProperties` queda abierto. Un `z.strictObject` lo
  cierra, y un catchall usa su schema.
- **Por qué no `z.toJSONSchema()`**: el `$jsonSchema` de MongoDB es el draft 4 sin `$ref`,
  `default`, `format`, el tipo `integer` ni keywords desconocidas, y usa `bsonType` para las fechas
  y los demás tipos de BSON. mongozod recorre el schema y escribe `bsonType` directamente.

## Referencias

`references` declara los campos que guardan el `_id` de otro documento, lo que el manual de MongoDB
llama references. `populate` los reemplaza por los documentos en `find`, `findOne` y las
`findOneAnd*`, las operaciones que devuelven documentos. Mongoose también popula en
`findOneAndUpdate`, y así un update que devuelve el documento no necesita otra consulta:

```ts
export const TransactionsModel = mongozod({
  schema: transactionSchema,
  collection: 'transactions',
  db,
  references: {
    createdBy: () => AccountsModel,
    organization: { collection: 'organizations', schema: organizationSchema }
  }
})

await TransactionsModel.find(
  {},
  { populate: { createdBy: { projection: { fullName: 1 } }, organization: true } }
)
```

- **Destinos**: una función que devuelve otro modelo, así se aplican sus plugins y sus virtuals, o
  una colección con su schema, para las que no tienen modelo, como las de Better Auth. Dos modelos
  pueden referenciarse entre sí, y un modelo a sí mismo, como el `parent` de las cuentas de
  wortise-dashboard-monorepo.
- **Campos**: un campo que guarda el `_id` del destino o un array de ids, en uno o más tipos de
  documento, también dentro de subdocumentos y arrays de subdocumentos, como el `items.product` de
  un pedido o el `shipping.carrier` de un envío, lo más común en quien viene de Mongoose. El path
  atraviesa los arrays como el de un filtro: `populate` reemplaza los ids en cada elemento y cada
  objeto, con una consulta por referencia, y el tipo de la lectura lo sigue. Un path con un índice,
  como `items.0.product`, no compila y lanza un `Error` al definir el modelo: dejaría los ids sin
  avisar en los demás elementos. Todas las referencias de los tres proyectos guardan un id; el único
  array es `advertisers`, en las cuentas de wortise-dashboard-monorepo.
- **Valores**: `true` trae el documento entero, como el `include: { author: true }` de Prisma y el
  `with` de Drizzle. Un objeto lo acota con los nombres de `FindOptions` del driver, cada opción
  chequeada contra el schema del destino, con las sugerencias del editor:
  - `projection` trae esos campos y se chequea como la del modelo referenciado, con sus virtuals;
  - `filter` deja en `null`, o fuera del array, los documentos que no cumplen, como el `match` de
    Mongoose. Va en un `$and` con el `$in` de los ids, así un `filter` sobre el `_id` acota las
    referencias en vez de reemplazarlas, y pasa por los plugins del destino;
  - `sort` ordena los arrays con el orden de la consulta; sin `sort`, un array conserva el orden en
    que guarda los ids;
  - `populate` puebla las referencias del destino, en varios niveles, a través de su modelo (fase
    5).

  Una opción desconocida no compila y lanza un `ZodError`, con el issue en
  `['populate', key, option]`.

  `limit`, `skip` y `perDocumentLimit` quedan afuera: con una consulta `$in` por lote, `limit` no
  es por documento, la trampa que documenta Mongoose, y `perDocumentLimit` hace una consulta por
  documento.

- **Uno a muchos** (fase 5): una referencia con `foreignField` trae los documentos del destino que
  apuntan a este, sin guardar sus ids, como el virtual populate de Mongoose:
  `posts: { model: () => PostsModel, foreignField: 'author' }`. `localField` es `_id` si no se
  pasa; son los nombres del `$lookup` de MongoDB. Devuelve un array, y su key no es un campo del
  schema, porque no se guarda. Va en `references` y no en `virtuals` porque se pide por lectura y
  va a la base, como el resto de `populate`. La opción `count` de Mongoose y las referencias
  dinámicas con `refPath` quedan para después de la v1.
- **Faltantes**: un documento que no existe, o que un plugin del destino filtra, queda en `null`,
  como en Mongoose, y un array guarda los que encuentra. El tipo es `Ref | null`, así que el código
  lo maneja con `?.` sin chequear `typeof`. MongoModel dejaba el id.
- **Consultas**: una `$in` por referencia y por lote del servidor, con cada id una vez y la sesión
  de la lectura, así ve las escrituras de su transacción. Las referencias de un lote se consultan
  en paralelo.
- **Con una proyección**: una inclusión trae igual las referencias que se populan, como trae los
  campos de un virtual, salvo que ya incluya la referencia o un objeto de arriba, como `items`: pedir
  las dos sería una colisión de paths para MongoDB. Una exclusión que deja afuera una referencia que
  se popula, o un objeto de arriba, no compila y lanza un `ZodError`. Si la proyección del destino deja afuera el `_id`, mongozod lo pide igual
  para ubicar cada documento y después lo quita.
- **Chequeos**: no compila un `populate` con una key que no es una referencia, ni el de un campo
  que guarda otro tipo que el `_id` de su destino, porque el `$in` no encontraría nada. En runtime,
  una key que no es una referencia lanza un `ZodError`, con el issue en `['populate', key]`. Una
  referencia que no es un path del schema no compila y lanza un `Error` al definir el modelo.
- **Dónde se chequea el destino**: al pedir el `populate`, no al declarar la referencia. Chequearlo
  al declararla hace circulares los tipos de dos modelos que se referencian, de un modelo que se
  referencia a sí mismo y de uno con dos referencias al mismo modelo (`TS7022`). Por eso el tipo de
  un modelo referenciado solo pide su `schema` y sus `virtuals`, y `populate` lee con el `find` que
  `mongozod()` registra para cada modelo. Un destino que no es una función ni
  `{ collection, schema }` lanza un `Error` al definir el modelo.
- **Para clientes**: un `populate` que llega en runtime, como el de `mz.populate`, deja cada
  referencia como unión con el id, porque puede no haberse pedido. Ver
  [Inputs de los endpoints](./inputs.md#decisiones-de-los-inputs).

## Virtuals

El único virtual de los tres proyectos es `fullName`, en las cuentas de wortise-dashboard-monorepo:

```ts
export const AccountsModel = mongozod({
  schema: accountSchema,
  collection: 'accounts',
  db,
  virtuals: {
    fullName: accountSchema
      .pick({ firstName: true, lastName: true })
      .transform((account) => `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim())
  }
})
```

- **Un schema de Zod**: el `pick` declara qué campos necesita el virtual y el `transform` lo
  calcula, así que el `transform` recibe solo esos campos, tipados. Es un objeto literal sin helper,
  porque cada virtual ya trae sus tipos, y se puede definir junto al schema y usar también en el
  cliente. better-auth no tiene un equivalente: ni `additionalFields` ni `customSession` declaran de
  qué campos depende un valor. Con Zod Mini es `z.pipe(z.pick(accountSchema, { … }), z.transform(…))`:
  mongozod lee los campos del objeto al principio de los pipes.
- **Chequeos**: no compila un virtual que lee un campo que el documento no tiene, ni uno que lo lee
  con otro tipo, ni uno que se llama como un campo. En runtime, el primero y el último lanzan un
  `Error` al definir el modelo. mongozod vuelve a validar los campos del `pick` en cada lectura, así
  que un campo cuyo transform cambia el tipo no se puede tomar: tampoco compila.
- **Varios tipos**: los campos que lee un virtual tienen que estar en todos los tipos de documento,
  como los de `timestamps`, así el virtual existe en todos y tiene un solo tipo.
- **Dónde**: en las mismas lecturas que `populate`: `find`, `findOne` y las `findOneAnd*`. El
  `document` de `insertOne` sigue siendo exactamente lo que se guardó.
- **Datos inválidos**: si un documento guardado no pasa el schema de un virtual, como un dato
  viejo, la lectura lanza el `ZodError`, con el path del campo. Omitir el virtual obligaría a tipar
  todos como opcionales.
- **Proyección**: si pide un virtual, mongozod le pide al servidor los campos del `pick`, lo calcula
  y devuelve solo lo pedido: `{ fullName: 1 }` da `{ _id, fullName }`. Una exclusión lo mantiene,
  salvo que excluya uno de esos campos o una parte. Hoy la tabla de billings de
  wortise-dashboard-monorepo tiene que pedir `firstName` y `lastName` para recibir `fullName`. Un
  virtual toma 0, 1, `true` o `false`.
- **Campos cambiados**: el virtual se calcula con los campos tal como están guardados, así que una
  proyección que lo pide y cambia uno de sus campos, con un subcampo
  (`{ 'name.first': 1, fullName: 1 }`), `$slice` o `$elemMatch`, no compila y lanza un `ZodError`.
  Pedir el campo entero chocaría con el subcampo (código 31249), y recortarlo después sería
  reimplementar la proyección de MongoDB.
- **`populate`**: pasa por el modelo referenciado, así que aplica sus virtuals:
  `{ createdBy: { fullName: 1 } }` da `createdBy: { _id, fullName }`.
- **Listas blancas**: los schemas de validación no importan modelos, así que una lista blanca de
  `mz.populate` o `mz.projection` suma el virtual como un campo más, como
  `accountSchema.pick({ _id: true }).extend({ fullName: z.string() })`. Cuando el router le pasa el
  input al modelo, los tipos comprueban que cada key sea un campo o un virtual del modelo
  referenciado.
- **Lo que no hace**: como en Mongoose, un virtual no se guarda en la base, no se puede filtrar ni
  ordenar por él (no compila) y escribirlo tampoco compila. `aggregate` no los aplica: se calculan
  con `$addFields`. No hay setters en la v1, porque ningún proyecto los usa.

## Varios tipos de documento

Una colección puede guardar varios tipos de documento, lo que Mongoose resuelve con sus
discriminators. El schema es una `z.discriminatedUnion` de objetos:

```ts
const eventSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('click'), url: z.url() }),
  base.extend({ kind: z.literal('view'), seconds: z.number().int() })
])

await EventsModel.updateOne({ kind: 'click' }, { $set: { url } })

// error: "url" is not in every type the filter allows: fix "kind" in the filter
await EventsModel.updateOne({}, { $set: { url } })
```

- **Key**: es la que se le pasa a `z.discriminatedUnion`, como el `discriminatorKey` de Mongoose;
  `kind` es solo el ejemplo. A diferencia de Mongoose, que agrega su propio campo `__t`, es un campo
  más del schema.
- **Paths**: cada key se busca en todos los tipos, y la proyección se tipa tipo por tipo.
- **Updates**: cada campo que escribe un update tiene que estar en todos los tipos que permite el
  filtro. El filtro fija el tipo con una igualdad, `$eq` o `$in` sobre el discriminador, en su
  primer nivel o dentro de `$and`, que es como los routers de adsgpt componen los filtros. Los
  campos que tienen todos los tipos no necesitan filtro, y un valor tiene que servir para todos los
  tipos permitidos.
- **Discriminador**: no se cambia con un update, porque el documento quedaría sin los campos de su
  nuevo tipo; se reemplaza con `replaceOne`. Mongoose tampoco deja actualizarlo, salvo con
  `overwriteDiscriminatorKey`. En un upsert, `$setOnInsert` sí puede fijarlo.
- **Plugins**: los campos que exige un plugin, como `deletedAt`, tienen que estar en todos los
  tipos.
- **Intersecciones**: no se aceptan. La documentación de Zod recomienda `A.extend(B)` para combinar
  objetos, porque una intersección no tiene `pick` ni `omit`, y `.extend()` da un `z.object`.
- **Uniones dentro de un campo**: la misma regla. El discriminador de cada unión del path lo fija
  la condición que elige su documento o su elemento: el filtro o, si el path pasa por un `$[id]`,
  su entrada de `arrayFilters`, como `{ 'a.details.plugin': PluginId.GoogleAds }`. Con `$`, `$[]`
  o un índice no se puede fijar, así que solo se escriben los campos de todos los tipos. El
  discriminador de una unión anidada cambia reemplazando el objeto entero.
