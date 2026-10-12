# Tipos

- **Escrituras**: `insertOne` recibe el `z.input` del schema, así que `insertOne({ organization })`
  sin `title` no compila. Los reemplazos reciben lo mismo (ver
  [Reemplazos](./operations.md#reemplazos)).
- **Lecturas**: devuelven el `z.output` del schema, ajustado por la proyección: con `{ title: 1 }`
  el resultado es `{ _id, title }`. Si la proyección llega en runtime, como la de un cliente, los
  campos que puede dejar afuera quedan opcionales.
- **Filtros, updates y proyecciones**: tienen tipos estrictos propios. Los del driver no alcanzan:
  tanto `Filter<Note>` como `StrictFilter<Note>`, que es experimental, aceptan
  `{ organization: ['a'] }` en un campo string. Los dos heredan de `Document` una firma de índice
  que acepta cualquier valor.
- **Paths con punto**: TypeScript no genera todos los paths posibles. Busca en el schema cada key
  que aparece en el código, igual que la validación en runtime. Vale para filtros, updates,
  `arrayFilters` y proyecciones. Así no hace falta un límite de niveles y se cubren los schemas
  recursivos. Generarlos todos, como hace el driver, no compila con `blueprints`. `arrayFilters` se
  tipa según los `$[id]` del update, y la proyección ajusta el tipo del resultado a lo que responde
  MongoDB. Las sugerencias del editor se calculan aparte desde el schema: hasta 6 niveles, con `$[]`
  en los arrays de los updates, y sin entrar en `z.custom`, records, `z.lazy` ni transforms. Una key
  de tipo `string` no compila: tiene que ser literal.
- **Strings de Mongoose**: un `sort`, una `projection` o un `populate` en un string, como
  `sort: '-createdAt'`, no compilan, y el `sort` y la `projection` lanzan un `ZodError` en runtime:
  el driver ordenaba en silencio por un campo con ese nombre. El problema llega como una propiedad
  que falta, porque la restricción de un genérico no puede ser condicional sobre él.

## Filtros

Cada key del filtro es un path del documento, que se busca en el schema como en
[Paths con punto](#paths-con-punto), y cada condición tiene que servir para su campo. Se aplica en
todas las operaciones, en los filtros de `bulkWrite` y en los `$match` de `aggregate`. `V` es el
tipo del campo y `E` el de sus elementos, si es un array:

| Operadores                                            | Regla                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Igualdad, `$eq`, `$ne`, `$in`, `$nin`                 | `V`, o `E` en un array. Un `RegExp` en strings, y `null` solo donde el campo puede faltar o ser `null`.                                  |
| `$gt`, `$gte`, `$lt`, `$lte`                          | Del tipo del campo, salvo en booleanos y objetos: números, strings, fechas e ids.                                                        |
| `$exists`, `$type`                                    | En cualquier campo, como el driver.                                                                                                      |
| `$regex` (con `$options`)                             | Solo en strings. `$not` recibe operadores o un `RegExp`.                                                                                 |
| `$mod` y los operadores de bits                       | Solo en números; los de bits, también en `Binary`.                                                                                       |
| `$all`, `$size`, `$elemMatch`                         | Solo en arrays. `$elemMatch` chequea el elemento como un filtro: sus paths si es un objeto, operadores si no.                            |
| Geoespaciales                                         | Con las formas del driver. Ningún proyecto los usa.                                                                                      |
| `$and`, `$or`, `$nor`                                 | Cada filtro de la lista se chequea igual.                                                                                                |
| `$expr`, `$jsonSchema`, `$text`, `$where`, `$comment` | Como el driver. `$where` no está deprecado, pero el manual recomienda `$expr`, que no ejecuta JavaScript. `mz` no los expone a clientes. |

- **`_id`**: siempre existe; es un `ObjectId` si el schema no lo declara.
- **`undefined`**: no compila. El driver lo manda como `null`, que coincide con los documentos sin
  el campo o con `null`, y con `ignoreUndefined` la key desaparece y coincide con todos. Para eso
  se escribe `null` o `$exists: false`. En runtime no se toca. Un filtro armado con tipos que tienen
  keys opcionales, como la salida de `mz.filter`, sigue compilando.
- **Sin casting**: Mongoose convierte cada valor del filtro según el schema, como `'42'` a `42` o
  un hex a `ObjectId`, y lanza un `CastError` si no puede
  ([Query Casting](https://mongoosejs.com/docs/tutorials/query_casting.html)). mongozod no toca
  los filtros en runtime: un valor del tipo equivocado no compila, y lo que llega sin tipos, como un
  `req.params.id`, se parsea en los inputs, donde `mz.filter` convierte cada valor con el schema de
  su campo y [`objectId()`](./inputs.md#decisiones-de-los-inputs) el hex. Castear en el modelo
  repetiría a `mz.filter` en cada consulta. En JavaScript, un valor de otro tipo no encuentra nada.
- **Errores**: cada uno nombra su motivo, como `"author.nam" is not a path of the document` o
  `"$regex" only applies to strings`.
- **`$match`**: se chequean los del principio del pipeline, hasta la primera etapa que cambia la
  forma de los documentos; `$sort`, `$limit` y `$skip` la conservan. Un pipeline armado en otro
  lado, como un `Document[]`, no se chequea.
- **`sort`**: solo la forma de objeto, `{ path: dirección }`, con `1`, `-1`, `'asc'`, `'desc'`,
  `'ascending'`, `'descending'` o `{ $meta: 'textScore' }`, en las opciones y en el cursor. Las keys
  se chequean como en los filtros, salvo la que ordena por relevancia, que puede tener cualquier
  nombre, como el campo que agrega la proyección con `$meta`.
- **`distinct`**: la key es un path, y el resultado tiene el tipo de sus valores, aplanando los
  arrays como el driver.
- **Services**: un service que reenvía un filtro lo recibe con un genérico, como
  `<const F extends FilterOf<typeof NotesModel, F>>(filter: F)`, en vez del `Filter` del driver.

## Updates

Cada path de un update se busca en el schema como en [Paths con punto](#paths-con-punto), y cada
valor tiene que servir para su operador y su campo. Se aplica en `updateOne`, `updateMany`,
`findOneAndUpdate` y los updates de `bulkWrite`. El runtime que valida los valores llega en la fase
2.3.

| Operadores                             | Regla                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `$set`, `$setOnInsert`, `$min`, `$max` | El `z.input` del campo: un ISO en un campo que lo transforma en `Date` compila.                                    |
| `$unset`                               | Solo en campos opcionales. Uno con `.default()` no lo es.                                                          |
| `$inc`, `$mul`, `$bit`                 | Solo en números; `$inc` y `$mul` también en un `Decimal128`, con el valor que parsea su schema sin sus checks.     |
| `$currentDate`                         | Solo en fechas, con `true` o `{ $type: 'date' }`.                                                                  |
| `$push`, `$addToSet`                   | Solo en arrays, con el `z.input` del elemento, también en `$each`. `$push` acepta `$position`, `$slice` y `$sort`. |
| `$pop`, `$pullAll`                     | Solo en arrays.                                                                                                    |
| `$pull`                                | Solo en arrays, con una condición sobre el elemento, como `$elemMatch`.                                            |
| `$rename`                              | De un campo opcional a otro que guarda el mismo tipo: el servidor mueve el valor guardado, sin parsearlo.          |

- **Uniones**: cada campo que escribe un operador tiene que estar en todos los tipos que permite el
  filtro o, dentro de un array, la entrada de `arrayFilters` de su `$[id]`, como en
  [Varios tipos de documento](./model.md#varios-tipos-de-documento). Los errores dicen qué fijar,
  como `"url" is not in every type allowed: fix "kind" in the filter`.
- **`arrayFilters`**: son obligatorios cuando el update usa un `$[id]`, y cada entrada tiene que ser
  de un identificador del update, con sus condiciones chequeadas como un filtro sobre el elemento.
  Que falte o sobre una entrada lo rechaza el servidor, con los códigos 2 y 9.
- **`undefined`**: compila. En runtime la key se descarta y el campo conserva su valor, como en
  Mongoose 6 o superior, así que sirve para updates parciales. A diferencia de un filtro, no cambia
  qué documentos se tocan.
- **Lo que queda en el servidor o en el driver**: dos operadores sobre el mismo path, o un objeto y
  uno de sus campos, los rechaza el servidor con el código 40. Un update vacío lo rechaza el driver
  antes de mandarlo.
- **Pipeline**: un update con pipeline de agregación pide `updatePipeline: true`, como Mongoose 9,
  que los rechaza por defecto. Sin la opción no compila y lanza un `ZodError`
  (`an update with a pipeline needs updatePipeline: true`).
  - **Dónde**: en las opciones de `updateOne`, `updateMany` y `findOneAndUpdate`, y en las de la
    llamada de `bulkWrite`, como `timestamps: false`. Solo por operación, no en el modelo: así cada
    update sin validar queda escrito donde se hace.
  - **Etapas**: los tipos aceptan solo las que MongoDB permite en un update (`$set` o `$addFields`,
    `$unset` o `$project`, y `$replaceWith` o `$replaceRoot`), con un mensaje que las nombra; en
    runtime las chequea el servidor. El filtro sigue tipado.
  - **Valores**: no se validan, porque son expresiones que calcula el servidor; lo que no se ve lo
    cubre el `$jsonSchema` opcional. Un upsert tampoco agrega los defaults que le faltan al
    documento: no se puede saber qué escribe el pipeline.
  - **Plugins y `timestamps`**: pasan por los plugins, así que `softDelete` deja afuera los borrados,
    y `timestamps` agrega una última etapa con `updatedAt`, como Mongoose. En un upsert, esa etapa
    también pone `createdAt: { $ifNull: ['$createdAt', now] }`: el documento que existe conserva el
    suyo, y el que inserta el upsert lo recibe. Mongoose no lo pone, y el documento queda sin
    `createdAt`.
  - **`.collection`** también los acepta, pero se saltea los plugins, `timestamps` y el filtro
    tipado.

## Updates en runtime

El runtime aplica las mismas reglas que los tipos, para lo que escapa a ellos: un update armado en
runtime o código sin tipos. Cada problema se junta en un solo `ZodError`, con el path
`[operador, path]`, como `$set title`.

- **Valores**: cada valor que se escribe se parsea con el schema de su path, con sus refinements,
  defaults y transforms, y se escribe lo que devuelve Zod: un ISO llega como `Date`. Si el filtro
  permite varios tipos de documento, el valor tiene que servir para todos. Las keys en `undefined`
  se descartan, y si un operador queda vacío se manda así: MongoDB acepta `{}` en todos los
  operadores desde la versión 5.0.
- **Por operador**: `$unset` y el origen de `$rename` solo en campos opcionales (`.default()` no
  lo es); `$inc`, `$mul` y `$bit` en números, y un `$inc` o un `$mul` con decimales no va a un campo
  entero; `$currentDate` en campos que aceptan una `Date`; los operadores de array en arrays, y
  `$push` y `$addToSet` parsean cada elemento, también en `$each`. Un set de `mz.set()` solo
  agrega con `$addToSet`: `$push` y los paths que escriben uno de sus elementos no se aceptan (ver
  [Inputs](./inputs.md#decisiones-de-los-inputs)). Que el destino de `$rename` tenga
  el mismo tipo solo lo chequean los tipos: en runtime no se conoce el valor sin leer el documento.
- **Enteros**: Zod clásico expone si un campo es entero, con el `format` de `z.number()`, pero Zod
  Mini no, y el `aggregateChecks` que lo calcula no se exporta desde `zod/v4/core`. Así que se prueba
  con `0.5`, que sirve para los dos: un campo entero lo rechaza con `expected: 'int'`, en todas las
  formas (`.int()`, `z.int()`, `z.int32()` y Mini).
- **Upserts**: además, se arma el documento que insertaría el servidor, como lo hace MongoDB 8.2, y
  se valida con el schema; sus errores llevan el path del documento. Los defaults que le faltan se
  agregan con `$setOnInsert`, en el path más profundo que no choca con lo que deciden el filtro o el
  update: con `$set: { 'settings.theme': 'dark' }` se agrega `'settings.layout'`. Así el `_id` del
  `.default()` llega también a los documentos que crea un upsert. Del filtro se copia lo que copia
  el servidor (verificado con MongoDB 8.2.6): una regex suelta o en un `$in` no se copia, porque
  compara por patrón, pero la de un `$eq` sí; y un `undefined` se copia como el `null` que manda el
  driver.
  - **`_id` nulo**: un upsert cuyo filtro deja el `_id` en `null`, o en un `undefined`, lanza un
    `ZodError`, también en los reemplazos: insertaría un documento con `_id: null`, el caso de
    Mongoose [#9201](https://github.com/Automattic/mongoose/issues/9201).
  - **Valores que el schema cambia**: el servidor copia el valor del filtro tal cual, sin pasar por
    Zod. Si el schema lo guardaría distinto, como un email que un transform pasa a minúsculas o un
    objeto al que le falta un default, el upsert lanza un `ZodError` en ese path: filtrar por el
    valor que guarda el schema. Un path que el update también escribe no se compara, porque lo
    decide el update.
- **Pipeline**: un update que no es un objeto lanza un `ZodError`.

## Sugerencias del editor

El editor sugiere los paths de filtros, `sort`, `distinct` y updates, y los operadores de update.
Los operadores de query (`$gte`, `$in`…) todavía no: dentro de un campo de un filtro sugiere los
miembros de su tipo, y queda para después de la 0.x, midiendo su costo de tipos. Cada
operación chequea el argumento en su parámetro de tipo y toma las sugerencias en el tipo del
parámetro, como `filter: F & SuggestedFilter<S>`. Juntarlos en la restricción costaba casi tres
veces más en los updates, porque se intersectan con los paths sugeridos en cada llamada. Para un
service que recibe un filtro o un update y lo pasa al modelo, mongozod exporta `FilterOf`,
`SortOf` y `UpdateOf`, que parten del modelo y traen las dos cosas.

## Costo de los tipos

`pnpm check-type-cost` mide las instanciaciones de un proyecto típico (ver
[Herramientas](./structure.md#herramientas)). Estas reglas las bajan sin cambiar lo que compila, los
mensajes de mongozod ni lo que sugiere el editor:

- **Sin intersectar dos arrays**: una sugerencia no se intersecta con la lista que declara el mismo
  argumento. Con `readonly ['$eq'] & ReadonlyArray<…>`, TypeScript compara cada método de los dos
  arrays al chequear las propiedades de la intersección. Por eso, para un path que `mz.filter`
  declara, la sugerencia es su propia lista, que chequea `FilterFieldsCheck`. El editor sugiere lo
  mismo, porque infiere sin el argumento que se está escribiendo. `mz.update` hace lo mismo, pero solo
  cuando todos los paths de la lista son sugeridos: la sugerencia rechaza los que no sugiere, como los
  de más de 6 niveles, y así sigue.
- **Keys opcionales**: si una key es opcional se pregunta con `object extends Pick<T, K>`, que no
  compara el tipo de la propiedad. `Pick<T, K> extends Required<Pick<T, K>>` da lo mismo, pero en
  TS 5.5 reinstancia la cadena del output de Zod en cada key: era el tipo más caro de las
  proyecciones.
- **Listas válidas, tal cual**: un chequeo que recibe una lista sin problemas la devuelve sin
  mapearla, que es lo que daría el mapeo. Mientras infiere el argumento, TypeScript evalúa el chequeo
  de cada elemento una y otra vez. `mz.filter` devuelve así una lista de operadores que aplican, sin
  `$elemMatch`, y `mz.update`, una de paths sugeridos para su operador que no nombran un elemento.
- **`arrayFilters`**: cuando las opciones traen un array, la base no lo tipa como
  `ReadonlyArray<Document>`, y el chequeo pide que cada entrada sea un `Document`. Así no se
  intersectan dos arrays. Una entrada que no es un documento, como `null`, da un error más corto, que
  la señala.
- **Un recorrido de sugerencias**: `PathSuggestions` solo distingue los updates, así que filtros y
  proyecciones comparten el mismo recorrido del schema.
- **Objetos primero**: `Step` prueba primero si el schema es un objeto, el paso más común. Cada
  definición de Zod tiene su propio `type`, así que el orden no cambia el resultado.
- **Lo que no se usa no se arma**: `mz.filter` arma las declaraciones bajo un campo solo si declara
  `$elemMatch`, la única rama que las lee.
- **Modificadores homomórficos**: una inclusión conserva el `?` de cada campo con un mapped type
  homomórfico, en vez de preguntar por cada key.
- **Sin `timestamps`, sin chequeo**: `TimestampsCheck` no busca los campos cuando la opción está
  apagada.

## Paths con punto

Los tipos siguen la regla de [Tipos](#tipos). Además:

- **Valores**: cada valor se valida con el schema de su path, con refinements, defaults y
  transforms: un ISO en `'connections.$[c].syncedAt'` llega como `Date`. Un objeto entero, como
  `'connections.$[c]'`, reemplaza el subdocumento completo, así que se valida como un insert. Las
  reglas por operador se aplican por path.
- **Hasta dónde llegan**: hasta donde acepta el schema, como Zod al validar. Además de los campos
  declarados, las keys de un record, las keys extra de un objeto con `.catchall()` o de un
  `looseObject`, tipadas con su catchall, y cualquier cosa debajo de `z.unknown()` o `z.any()`. Se
  frenan en los transforms y en `z.custom()`, que no tienen un schema para lo que hay adentro.
- **Por operación**: los filtros atraviesan arrays y aceptan índices. Los updates no los
  atraviesan, porque el servidor responde con el código 28, y usan un índice, `$`, `$[]` o
  `$[id]`. La proyección los atraviesa, pero no toma índices.
- **Proyección estricta**: no compila lo que MongoDB acepta pero responde distinto: un índice, un
  path que no existe, `$slice` o `$elemMatch` sobre algo que no es array, un string (MongoDB lo
  devuelve como valor literal) y un `$` que atraviesa dos arrays. Las expresiones de agregación se
  usan con `aggregate`, salvo `{ $meta: 'textScore' }`, que agrega la relevancia de una búsqueda de
  texto como un campo `number`. La proyección va en las opciones de `find`, `findOne` y los
  `findOneAnd*`, o en `.project()`, que reemplaza a la de `find` como en el driver, y ajusta el tipo
  de lo que devuelven. Una proyección vacía devuelve el documento entero. Si incluye o excluye se
  decide como en MongoDB 8.2 (verificado): sin otras inclusiones ni exclusiones, un `_id: 1` la
  vuelve una inclusión, así `{ _id: 1 }` devuelve solo el `_id` y `{ _id: 1, tags: { $slice: 1 } }`,
  el `_id` y `tags`; con una exclusión, como `{ _id: 1, tags: 0 }`, sigue siendo una exclusión.
- **Nombres de campo**: `mongozod()` lanza un `Error` si el schema tiene un campo con `.` o que
  empieza con `$`, porque ningún path llegaría a él. Al escribir, se rechaza cualquier key así en lo
  que se escribe: la de un record, un catchall, un `looseObject`, un `z.unknown()` o un `z.json()`,
  en los inserts, los reemplazos y los valores de los updates.
- **Inputs**: `mz` acepta paths con punto declarados uno por uno en la lista blanca. Los operadores
  posicionales y `arrayFilters` no se exponen a clientes en la v1: los arma el router. Por eso
  `mz.update` y `mz.after` solo toman paths fuera de arrays.
- **Lo que no se puede validar en la app**: un `$set` con punto crea los padres que faltan, y un
  índice fuera del array lo rellena con `null`. Se documenta y lo cubre el [`$jsonSchema`](./model.md#sincronización). Ninguno
  de los tres proyectos escribe con punto en un objeto opcional con otros campos obligatorios.
