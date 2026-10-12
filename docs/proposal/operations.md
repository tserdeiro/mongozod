# Operaciones

Las operaciones se agrupan para que un plugin declare sus opciones, su contexto y sus hooks una
sola vez por grupo.

| Grupo    | Operaciones                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| `read`   | `find`, `findOne`, `countDocuments`, `distinct`                                  |
| `insert` | `insertOne`, `insertMany`                                                        |
| `update` | `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace` |
| `delete` | `deleteOne`, `deleteMany`, `findOneAndDelete`                                    |
| `bulk`   | `bulkWrite`                                                                      |

`aggregate` y `estimatedDocumentCount` no tienen grupo, porque no tienen filtro: solo corren sus
propios hooks y el `middleware` (ver [Hooks](./plugins/README.md#hooks)).

## Cómo funciona una operación

Cada operación es un wrapper del método del mismo nombre del driver:

1. Corre los `before` y el `middleware` de los plugins.
2. Valida con Zod lo que se escribe, junto con el contexto y las opciones de los plugins.
3. Llama al método del driver con las mismas opciones, sin las de los plugins.
4. Corre los `after`.
5. Devuelve el resultado del driver.

La consulta la hace el driver: mongozod no reimplementa nada. Lo que no está envuelto, como `watch`
o la administración de índices, se usa con `.collection`.

## Resultados

Las operaciones conservan la firma y los resultados del driver. Lo que agrega mongozod va como una
opción más, como `schema` en `aggregate(pipeline, { schema })` o las opciones que declaran los
plugins.

`find` devuelve un cursor como el `FindCursor` del driver. Se recorre igual, se le encadenan los
mismos métodos y además se puede esperar con `await` para obtener el array:

```ts
const all = await NotesModel.find({ organization: 'o' })

for await (const note of NotesModel.find({ organization: 'o' })) titles.push(note.title)

const projected = await NotesModel.find({ organization: 'o' })
  .sort({ createdAt: -1 })
  .limit(20)
  .project({ title: 1 })
```

El cursor de `find` encadena `sort`, `limit`, `skip` y `project`. Los demás modificadores del
driver, como `hint`, `collation`, `comment`, `batchSize` o `maxTimeMS`, van en las opciones de
`find`, que ya los aceptan. El de `aggregate` no encadena nada, porque las etapas van en el
pipeline. Su `schema` valida cada lote de forma asíncrona, como las escrituras, así un refinement
puede ser async: con `z.parse`, uno async lanzaba el `$ZodAsyncError` de Zod (verificado).

Los `before` corren una vez, porque fijan la consulta, y el `middleware` y los `after` corren por
cada lote que devuelve el servidor, también con `await` o `toArray()`, que recorren el cursor lote
por lote: hasta 101 documentos el primero y hasta 16 MiB los siguientes. Así
`populate` hace una consulta `$in` por referencia y por lote. Un cursor fija su sesión al crearse,
así que para leer dentro de una transacción se pasa `session` en las opciones de `find`.

Los inserts son la única diferencia, y no rompen el código escrito para el driver:

| Operación    | Driver                                                                                                                                                          | mongozod                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insertOne`  | `Promise<InsertOneResult>`, que es `{ acknowledged, insertedId }`. El driver agrega el `_id` al objeto que recibe, modificándolo, y se sigue usando ese objeto. | El mismo `InsertOneResult` más `document`. Lo que se guarda es el resultado del schema, con defaults y codecs, y no coincide con lo que se pasó. La librería ya lo tiene porque lo armó al validar. |
| `insertMany` | `Promise<InsertManyResult>`, que es `{ acknowledged, insertedCount, insertedIds }`.                                                                             | El mismo `InsertManyResult` más `documents`, por el mismo motivo.                                                                                                                                   |

## Reemplazos

`insertMany` y `bulkWrite` validan todo el lote antes de escribir: si un documento o una operación
falla, no escriben nada y lanzan un solo `ZodError` con los issues de todos los que fallan, cada uno
bajo su índice, como `[1, 'title']` o `[1, '$set', 'title']`. También con `ordered: false`, que solo
deja pasar los demás ante los errores del servidor, como una clave duplicada: Mongoose, en cambio,
inserta los válidos. Lo dice su JSDoc.

Un update valida cada valor con el schema de su path. Los refinements del documento entero, como uno
que compara dos campos, corren solo en los inserts y los reemplazos, como en Mongoose: un update no
tiene el documento. Para chequearlos se lee el documento y se lo reemplaza con `replaceOne`. Lo dice
el JSDoc de `updateOne`, `updateMany` y `findOneAndUpdate`.

`replaceOne` y `findOneAndReplace` validan el reemplazo como un insert: reciben el `z.input` del
schema y aplican sus defaults, transforms y refinements, también los de la raíz. El `_id` se escribe
solo si se pasa. El `_id` de un documento no puede cambiar (el servidor responde con el código 66),
así que el que genera un `.default()` se descarta, igual que Mongoose, que arma el reemplazo con
`skipId`. Con un `_id` sin default, como el de las colecciones de Better Auth, se pasa el del
documento.

El driver tipa el reemplazo sin `_id` (`WithoutId`). Con el `_id` con `.default()` acordado, el
`_id` es opcional en el `z.input`, así que el código escrito para el driver compila igual.
Validarlo sin `_id` con el `omit` de Zod no sirve: lanza un error si el schema tiene refinements en
la raíz.

Con `upsert`, el servidor inserta el reemplazo con el `_id` del filtro, y no copia ningún otro campo
del filtro. Sin `_id` en el filtro, inserta un `ObjectId`, y un reemplazo no tiene `$setOnInsert`
para poner el del `.default()` solo al insertar. Por eso, si el schema declara `_id`, un reemplazo
con `upsert` necesita el `_id` por igualdad en el filtro, o lanza un `ZodError`. El documento que se
valida es el que se insertaría, el reemplazo con ese `_id`, así que un `_id` del filtro que el schema
no acepta, o que es `null`, lanza un `ZodError`.

## Paginación

El cursor del driver no sirve para paginar entre requests. Vive en el servidor de MongoDB, que lo
cierra cuando la sesión pasa más de 30 minutos inactiva, y con varias instancias del server el
request siguiente puede llegar a otra.

Para el scroll infinito, la paginación es por clave, con las consultas por rango que el manual de
MongoDB explica en `cursor.skip()`. El endpoint declara un `after` que recibe los valores de orden
del último elemento de la página, como `{ createdAt, _id }`, y lo convierte en el filtro de rango de
la página siguiente. MongoDB lo recomienda: `skip()` se vuelve más lento a medida
que crece el offset, y las consultas por rango usan índices. El orden tiene que terminar en un campo
único, como `_id`, para desempatar. `skip` y `limit` siguen disponibles para tablas con páginas
numeradas.

[`mz.after`](./inputs.md#decisiones-de-los-inputs) arma ese filtro y exige `_id` al final y campos
obligatorios: MongoDB ordena un valor que falta o es `null` antes que cualquier otro, y un rango
sobre la página siguiente no lo alcanza.
