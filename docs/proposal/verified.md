# Qué se verificó

- **Prototipo de tipos** (TypeScript 7.0.2, Zod 4.6.5 y driver 7.6.0). Compilan sin casts:
  - El soft delete con hooks.
  - Un logger con `middleware`.
  - Un historial que llama `next({ session })` dentro de `withSession` y `withTransaction`.
  - Un hook de grupo que acota `operation`.
  - Un método tipado por `this`.
  - `mongozod({ … })` con un único objeto.
  - El contexto por grupo: auditoría lo exige en las escrituras y no en las lecturas.
  - `find` como cursor que se recorre con `for await`, se espera con `await` y ajusta su tipo con
    `.project()`.
  - Los inputs de `brands` y su router sin fallbacks.
  - `populate` hacia una colección y hacia otro modelo, incluso entre dos modelos que se referencian
    entre sí, con una referencia por modelo. Ver **Referencias y virtuals** más abajo.

  Cada uno de estos casos falla por el motivo correcto:
  - `withDeleted` como opción de lectura, ahora que el plugin no agrega opciones.
  - `insertOne` sin `title`.
  - Un schema sin `deletedAt`, con el mensaje del plugin.
  - Un método de plugin con `{ title: 1 }`.
  - Una escritura y un método de plugin sin contexto cuando un plugin lo exige.
  - Un campo que no está en la proyección.
  - En los inputs: un `$regex` sobre una fecha, un campo que no existe, un `$unset` de un campo
    obligatorio y un `$inc` sobre un string.
  - En `populate`: el campo de un `populate` que manda el cliente, que puede seguir siendo el id; un
    campo no pedido y una referencia no declarada.
  - Una clase con los métodos de sus plugins: `TS2422` y `TS2312`.
  - Del primer prototipo, con el mismo mecanismo: un `deletedAt` de otro tipo, dos plugins con el
    mismo método y una opción de plugin usada en el grupo equivocado.

- **Tests de los constructores de inputs del prototipo** (16 en total, contra MongoDB 8.2 cuando
  hace falta). Los reemplaza la implementación de `mz`, más abajo, donde los defaults pasaron al
  proyecto:
  - El filtro rechaza `$where`, operadores y campos no declarados, y valores inválidos. Convierte una
    fecha ISO en `Date`, y con campos obligatorios no acepta `{}`.
  - El update no completa defaults, valida los refinements y rechaza operadores, campos no
    declarados y un update vacío.
  - El orden y la proyección rechazan campos y valores fuera de la lista, y la proyección no mezcla
    inclusión y exclusión.
  - El cursor recorre 7 documentos, 4 con la misma fecha, en páginas de 3, sin repetir ni saltear.
  - Un filtro y un cursor ausentes se convierten en `{}`.
  - `mz.populate` completa la lista blanca y rechaza campos de afuera, exclusiones y referencias
    no declaradas.

- **Paths con punto** (TypeScript 7.0.2 con 8 schemas de adsgpt, y 8 tests):
  - Compilan `{ $set: { 'prop.nestedProp': true } }`, los updates de `plugins`, un elemento entero
    con dos `$[id]`, un campo de un record, un schema recursivo y un ISO en un timestamp.
  - Fallan por el motivo correcto: un valor de otro tipo, un path que no existe, un update que
    atraviesa un array, un `$unset` de un campo con default, un `$inc` sobre un string, un
    `arrayFilters` que falta, un identificador mal escrito o con mayúscula, una condición de otro
    tipo y una key `string`.
  - En runtime, cada valor se parsea con el schema de su path: el transform de un timestamp, los
    defaults de un elemento entero, el regex de una opción de una unión discriminada y el entero de
    un record.
  - Generar todos los paths de antemano no compila con `blueprints`: `TS2589` después de 1,6
    millones de instanciaciones y más de 2 s, y con `StrictUpdateFilter` del driver, después de 6,2
    millones, 12,6 s y casi 2 GB. La causa son los `platforms`: el `z.json()` de Wortise Ads basta
    para el `TS2589`, y el `z.custom<services.MutateOperation>()` de Google Ads, solo, cuesta 2,2
    millones y 6 s. Sin `platforms`, compila. Además da errores en updates válidos, como un elemento
    entero con dos `$[id]` anidados o un campo de un record de objetos.
  - Buscar cada key en el schema suma 40 mil instanciaciones con 8 schemas de adsgpt, y 300 llamadas
    se chequean en 0,1 s.
  - El language server de TS 7 sugiere 38 paths de update en `plugins` y 110 en `blueprints`, y
    también los de filtros y proyecciones con puntos. La forma anidada de la proyección se valida,
    pero no se sugiere.

- **Proyección con paths con punto** (8 tests contra MongoDB 8.2 y 14 de runtime):
  - En cada caso, el resultado del servidor es el esperado, el schema proyectado lo valida al leer y
    el tipo es idéntico al esperado: paths con punto y forma anidada, un campo de una opción de una
    unión discriminada, un padre `null`, `_id: 0`, `$`, `$slice`, `$elemMatch` y una proyección
    que llega de un cliente.
  - `{ 'connections.credentials': 0 }` da exactamente el tipo de `publicPluginSchema` de adsgpt.
  - No compilan 16 proyecciones inválidas. En runtime se probaron 14, y las rechaza. Falta validar
    en runtime la condición de un `$elemMatch`, como un filtro sobre el elemento.
  - Con 11 proyecciones sobre 8 schemas, `blueprints` incluido, suma 33 mil instanciaciones.

- **Inputs, services y plugins** (prototipo de tipos y 2 tests de runtime):
  - `mz` convive con el `z` de `zod` en el mismo archivo, y `mz.filter` con un campo que no existe
    no compila.
  - Un service con `(filter, update, options)` reenvía un contexto obligatorio dentro de `options`
    sin perder los chequeos por key, tanto con un método propio como con el del modelo.
  - Los `fields` de `timestamps` siguen a sus opciones, renombrados o apagados, en los tipos y en
    runtime.

- **Unión discriminada en la raíz** (prototipo de tipos y 9 tests de runtime):
  - Las keys de filtros y updates se resuelven contra todas las opciones: cada campo toma el tipo de
    la opción que lo tiene, y uno que no tiene ninguna no compila.
  - La proyección se tipa opción por opción: `{ url: 1 }` da `{ _id; url } | { _id }`, como
    responde MongoDB. Sin distribuir, perdía los campos de una sola opción.
  - El filtro decide qué tipos toca un update. Compila con el tipo fijado por igualdad, `$eq`, `$in`
    o dentro de `$and`, y con los campos de todos los tipos sin fijarlo. Falla sin fijarlo, con
    `$ne`, dentro de `$or`, con un valor que no sirve para todos los tipos permitidos y al cambiar o
    borrar el discriminador. El runtime aplica la misma regla.
  - El discriminador puede ser cualquier key: con `z.discriminatedUnion('method', …)`, el mensaje
    pide fijar `method`.

- **Uniones dentro de un campo** (prototipo de tipos y 5 tests de runtime):
  - `loginCustomerId` de una cuenta compila con `{ 'a.details.plugin': PluginId.GoogleAds }` en
    `arrayFilters`, y falla sin fijarlo o con Wortise Ads. Un índice o `$[]` no fijan nada, y el
    discriminador anidado cambia reemplazando el objeto.
  - Una unión en un campo común la fija el filtro (`payment.method`), también dentro de `$and`, y un
    array de uniones, su entrada de `arrayFilters`.
  - En `blueprints`, escribir `youtubeOnly` en una plataforma exige fijar `p.plugin`. La regla de la
    raíz sigue igual con el mismo recorrido.

- **MongoDB 8.2** (con `mongodb-memory-server`):
  - Un índice `unique` parcial rechaza `deletedAt: { $exists: false }` y acepta `deletedAt: null`.
  - Un documento sin `deletedAt` entra en ese índice, y uno borrado sale.
  - El upsert sobre el `_id` de un documento borrado falla por clave duplicada.
  - Un upsert con `deletedAt: null` en el filtro copia el `null` al documento nuevo. Con
    `$exists: false`, no.
  - Un upsert arma el documento con las igualdades del filtro más el update: solo por `_id`, deja
    afuera los campos obligatorios que no estén en ninguno de los dos.
  - Del filtro copia una igualdad, `$eq`, cada parte de un `$and`, un `$in` o un `$or` de un solo
    valor y los paths con punto, pero no un `$in` de dos valores ni un `$gt`. De los operadores,
    `$set`, `$setOnInsert`, `$min`, `$max` e `$inc` crean el campo con su valor; `$push` y
    `$addToSet`, un array con sus elementos; `$currentDate`, una fecha; y `$mul` y `$bit`, un 0.
    `$pop`, `$pull`, `$pullAll`, `$unset` y `$rename` no crean nada.
  - Con `$jsonSchema`, un upsert que insertaría un documento sin un campo obligatorio falla con el
    código 121.
  - Sin `$jsonSchema`, el servidor rechaza `$foo`, un `$inc` sobre un string y un `$push` sobre
    algo que no es array, pero acepta `$set: { title: 123 }` y un `$unset` de un campo obligatorio.
    Con `$jsonSchema`, rechaza esos casos y un update con pipeline, con el código 121.
  - Crear de nuevo un índice idéntico no hace nada. Con la misma clave y otras opciones falla con
    `IndexKeySpecsConflict` (86), y con otro nombre crea un segundo índice sobre la misma clave.
  - Con paths con punto, `$set` crea los padres que faltan y falla si el padre es `null` (28). Un
    update no atraviesa arrays (28), y un índice fuera del array lo rellena con `null`.
  - `$` falla sin el array en el filtro o con dos arrays, y `$[id]` sin su `arrayFilters`; un
    `arrayFilters` sin usar falla con el código 9. Un objeto y uno de sus campos en el mismo update
    fallan con el código 40. Un upsert expande los paths con punto del filtro.
  - La proyección atraviesa arrays, no proyecta por índice y falla si pide un objeto y uno de sus
    campos (31249). Un campo llamado `a.b` solo se encuentra con `$getField`.
  - En una inclusión, un padre `null` queda afuera. Mezclar inclusión y exclusión falla (31253 y
    31254), igual que `$` en el medio del path (31394), dos `$` (31276) y `$elemMatch` sobre un
    campo anidado (31275). `$slice` solo devuelve todo el documento, y `$elemMatch` solo, el `_id`
    y el array. Un string se devuelve como valor literal, y un `$` que atraviesa dos arrays no falla,
    pero se aplica solo al primero: devuelve la conexión con todas sus cuentas.

- **Virtuals** (prototipo de tipos y 4 tests contra MongoDB 8.2):
  - Un `pick(...).transform(...)` solo ve los campos que toma. No compilan un virtual que lee un
    campo que el documento no tiene ni uno que lo lee con otro tipo.
  - Con `needs` y `get` en un objeto literal, el getter queda sin tipar; por eso se descartó esa
    forma. Un helper como el de Drizzle también funciona, pero Zod lo resuelve sin API propia.
  - Una lectura completa agrega `fullName`; `{ fullName: 1 }` da `{ _id, fullName }`; una
    exclusión lo mantiene salvo que excluya uno de sus campos; y `populate` lo calcula a través del
    modelo referenciado. En cada caso, el tipo coincide con lo que devuelve el servidor.
  - No compilan una proyección con una key que no es campo ni virtual, ni un `populate` que pide
    un virtual que el modelo referenciado no tiene.

- **Uso en los otros proyectos**:
  - En wortise-dashboard-monorepo, 42 archivos usan `MongoModel` y hay 46 menciones a upserts. En
    app-maker, sus modelos de datos son 26 archivos con 25 menciones a upserts.
  - El único `$set` con punto de wortise-dashboard-monorepo escribe en `metadata`, un record
    opcional, y app-maker no tiene ninguno.
  - El único virtual es `fullName`, en las cuentas de wortise-dashboard-monorepo. La tabla de
    billings pide sus dependencias para recibirlo, y el pipeline de organizations lo vuelve a
    calcular con `$concat`.

- **Driver 7.6 y documentación de MongoDB y Mongoose**:
  - Las firmas de `insertOne`, `insertMany` y `find`, y que `aggregate(pipeline, options)` devuelve
    un `AggregationCursor`.
  - `insertOne` agrega el `_id` modificando el documento que recibe.
  - `estimatedDocumentCount` estima con la metadata de la colección.
  - `Db.client` es público y `connect()` es opcional.
  - `Collection<T>` es invariante, por eso la vista que reciben los plugins expone `db` y `name` en
    vez de `collection`.
  - `skip()` se vuelve más lento a medida que crece el offset, y la documentación recomienda
    consultas por rango.
  - Una sesión inactiva por más de 30 minutos se cierra junto con sus cursores.
  - El cursor entrega lotes: el primero de hasta 101 documentos y los siguientes de hasta 16 MiB.
  - El `syncIndexes()` de Mongoose borra los índices que no están en el schema.
  - Desde la versión 5.0, el driver no tipa los paths con punto por defecto. `StrictFilter` y
    `StrictUpdateFilter` son experimentales y, según su documentación, pueden marcar errores en
    consultas válidas. El límite de 8 niveles se eligió por el tiempo de compilación.
  - Los change streams solo existen en replica sets y clusters sharded, y avisan de un cambio
    cuando ya está en la mayoría de los miembros. En un update traen los valores nuevos, no los
    operadores, y ningún campo del evento dice quién hizo el cambio. Cada stream abierto ocupa una
    conexión, y no se puede retomar si su punto ya salió del oplog.
  - Mongoose solo maneja `createdAt` y `updatedAt`. Se pueden renombrar, una operación puede
    saltearlos con `timestamps: false`, y `createdAt` es inmutable.
  - El manual de MongoDB llama references a los `_id` guardados en otro documento, y
    relationships a lo que esas referencias representan.
  - `AsyncLocalStorage` es estable en Node, y Bun lo implementa.
  - Las opciones de cada operación del driver ya llevan datos de la llamada, como `session` y
    `comment`, y ninguna se llama `context`. El driver también acepta un `pkFactory` para generar
    los `_id` desde el cliente.
  - Better Auth genera los ids con `advanced.database.generateId`, y define las tablas que
    necesita.

- **Nombre, subpaths y repo** (registro y documentación de npm, TypeScript 6.0.3 y repos de
  referencia):
  - `mongozod` lo publicó otro autor en 2023 y lo despublicó entero en 2025. Sus versiones, de la
    0.0.1 a la 0.1.1 y de la 1.0.0 a la 1.0.3, no se pueden volver a usar. La política de npm no
    dice si otra cuenta puede tomar un nombre despublicado, así que se confirma al publicar.
  - Un paquete sin scope siempre es público. `mongo-zod` y `mongodb-zod` no existen; `zod-mongo` y
    `mongoose-zod`, sí.
  - En el editor, con `mz` como único export, escribir `mz` ofrece el import, y `filter` no se
    sugiere. Con funciones sueltas, no se ofrece el import de `mz` y `filter` se sugiere desde el
    subpath. Con las dos cosas, pasan las dos.
  - Zod documenta `import * as z from "zod"`.
  - better-auth publica la mayoría de sus plugins como subpaths de `better-auth`, como
    `better-auth/plugins/organization`, y algunos como paquetes aparte, como `@better-auth/passkey`,
    `@better-auth/sso` y `@better-auth/stripe`. Varios de estos traen dependencias propias.

- **`timestamps`** (documentación de Mongoose y README de zod-mongo):
  - Mongoose tiene `timestamps` como opción del schema, no como plugin. zod-mongo también la tiene
    como opción, encendida por defecto, y agrega los campos por su cuenta.

- **Zod 4.5** (Zod 4.6.5):
  - `z.compile` devuelve una copia con el mismo `def` y el mismo `shape`, así que `pick` sigue
    funcionando, y da el mismo resultado y los mismos errores. Con un documento como los de adsgpt
    (uuids, URL, enums, fechas, un objeto y arrays de objetos) bajó de 1,1 µs a 0,5 µs por
    documento. Compila transforms, refinements, `z.custom`, `z.lazy` y uniones discriminadas; con
    `z.json()` o un schema recursivo devuelve el schema sin compilar. `import 'zod/compile'` respeta
    `jitless`; un `z.compile` explícito, no.
  - `z.deepPartial` completa los defaults: con `{}` da `{ content: '' }`. También acepta
    `author: {}` y `tags: [{}]`, que un `$set` guardaría reemplazando el objeto o el array entero.

- **`undefined`** (driver 7.6.0, MongoDB 8.2 y documentación de Mongoose):
  - Con sus opciones por defecto, el driver guarda `undefined` como `null`, en `insertOne` y en
    `$set`, y el documento ya no cumple un `.optional()`. Con `ignoreUndefined: true`, el insert
    omite el campo y un `$set` con `undefined` deja el valor anterior. Zod tiene `.exactOptional()`
    y `.exactPartial()` para rechazar el `undefined` explícito.
  - Mongoose descarta las keys en `undefined` de los updates desde la versión 6.

- **Operaciones y validación al escribir** (Zod 4.6.5, driver 7.7.0, MongoDB 8.2.6 y código de
  Mongoose):
  - El `parse` de `zod/v4/core` lanza un `$ZodError`, que no es instancia del `ZodError` de Zod
    clásico, tanto con schemas de Zod como de Mini. El `z.parse` de Zod clásico acepta schemas de
    Mini y lanza un `ZodError`, que también es instancia de `$ZodError`, con los mismos mensajes y
    el mismo resultado de `prettifyError`. Los dos son instancia de `Error`. wortise-dashboard-monorepo
    y app-maker atrapan `instanceof ZodError` de `zod` en sus handlers.
  - Importar Zod clásico no cambia nada global. Construir su primer schema registra el locale
    inglés como default si no hay otro configurado, y desde ahí los mensajes de un schema de Mini
    pasan de «Invalid input» a «Invalid input: expected string, received number». Un
    `z.config(locale)` explícito gana siempre.
  - Zod deja las keys en `undefined` en el resultado: `{ a: undefined }` da `{ a: undefined }`, y
    también dentro de un objeto anidado.
  - `replaceOne` con el mismo `_id` funciona; con otro, falla con el código 66. Un `replaceOne`
    con `upsert` y sin `_id` en el filtro ni en el reemplazo inserta un `ObjectId` generado por el
    servidor, aunque el schema diga otra cosa (queda para los upserts de la fase 2.3).
  - El `omit` de Zod (core `util.omit`, el de `.omit()` y `z.omit`) lanza un `Error` si el objeto
    tiene refinements en la raíz.
  - Mongoose arma el reemplazo de `replaceOne` y `findOneAndReplace` como un documento con
    `skipId: true`: no genera el `_id`, y respeta el que se pasa.
  - Si la función de `cursor.map()` lanza un error, el driver cierra el cursor y lo propaga, tanto
    al iterar como en `toArray()`.
  - Ningún modelo de los tres proyectos usa `replaceOne` ni `findOneAndReplace`, y ninguno valida
    con refinements asíncronos. Igual se soportan: con `z.safeParse`, un refinement asíncrono hace
    lanzar un `$ZodAsyncError` en toda escritura (verificado en la evaluación de la v1), así que las
    escrituras validan con `z.safeParseAsync`.
  - 20 tests del paquete contra MongoDB 8.2.6: los inserts guardan y devuelven el resultado del
    schema, sin keys en `undefined` y con el `ObjectId` del driver cuando el schema no declara
    `_id`; un documento inválido lanza un `ZodError` y no escribe nada, también en `insertMany` y
    `bulkWrite`; los reemplazos conservan el `_id`; `aggregate` valida cada documento con su
    `schema`; el `db` se resuelve una vez, en la primera operación; y el cursor de `find` se espera,
    se recorre con `for await` y encadena `sort`, `skip`, `limit` y `project`.

- **Recorrido de los paths** (Zod 4.6.5 y TypeScript 7.0.2, 10 tests):
  - `instanceof` con las clases de `zod/v4/core`, como `$ZodObject` o `$ZodOptional`, reconoce
    tanto schemas de Zod como de Mini, y TypeScript acota el tipo, así que el recorrido en runtime
    no necesita casts.
  - Los tipos de un objeto no guardan el schema de su catchall, solo su input y su output en
    `_zod.config`; por eso una key extra se tipa como `z.unknown()` con esos tipos. `z.object`
    y `z.strictObject` no tienen catchall en los tipos; `z.looseObject`, uno de `unknown`.
  - Los tipos y el runtime coinciden en cada caso: campos anidados, arrays por operación, índices,
    `$`, `$[]` y `$[id]`, records, catchalls, `z.unknown()`, uniones discriminadas, schemas
    recursivos con getters y los frenos en transforms y `z.custom()`.
  - En los tres proyectos aparecen records, `z.json()`, `z.unknown()`, `z.any()`, `.catchall()`,
    `looseObject`, `.loose()`, `z.lazy()` y `z.preprocess()`.
  - Un campo con `.` o que empieza con `$` lanza un `Error` al definir el modelo, también dentro de
    arrays y uniones; un schema recursivo no entra en un ciclo.

- **Filtros** (TypeScript 7.0.2, driver 7.7.0, MongoDB 8.2.6 y 8 schemas de adsgpt):
  - Con las opciones por defecto, `{ org: undefined }` coincide con los mismos documentos que
    `{ org: null }`: los que no tienen `org` y los que lo tienen en `null`, también dentro de `$eq`,
    `$in` y `$and`. Con `ignoreUndefined: true`, en la operación o en el cliente, coincide con
    todos.
  - El manual no depreca `$where`: solo su forma con scope, desde la 4.2.1. Recomienda `$expr`, que
    no ejecuta JavaScript, y `$function` si hace falta JavaScript.
  - Los tipos compilan los casos válidos de cada operador y fallan con el motivo correcto en los
    inválidos: un valor de otro tipo, una opción que no está en el enum, `$regex` en un número,
    `$gt` en un booleano, un operador que no existe, `null` en un campo obligatorio, `$size` en un
    string, un campo que el elemento de `$elemMatch` no tiene, un path que no existe, una condición
    inválida dentro de `$or`, un `undefined` y una key `string`. Un filtro armado con keys
    opcionales sigue compilando.
  - Con 23 llamadas de filtros, `sort` y `distinct` sobre 8 schemas de adsgpt, `blueprints` y
    `plugins` incluidos, suma 53 mil instanciaciones, y el chequeo pasa de 0,049 s a 0,078 s. Atrapó
    dos errores reales al escribirlas: `budget.amount`, que en el schema es `amountMicros`, y un
    string donde va un enum de TypeScript.
  - El language server de TS 7 sugiere 128 keys en un filtro de `blueprints` (los paths y los
    operadores de la raíz), 120 en `sort`, en las opciones y en el cursor, y 120 en `distinct`.
  - Una restricción genérica que es una unión con un condicional sobre el mismo parámetro es
    circular para TypeScript (`TS2313`). Por eso `distinct` chequea la key en el parámetro
    (`K & DistinctKey<S, K>`), y el pipeline usa un condicional no distributivo.

- **Updates** (TypeScript 7.0.2, driver 7.7.0, MongoDB 8.2.6 y 8 schemas de adsgpt):
  - Los tipos compilan cada operador en los campos que le corresponden, los paths con `$`, `$[]` y
    `$[id]`, un elemento entero, los records, un ISO en un campo de fecha con transform y un
    `undefined`. Fallan con el motivo correcto: un valor de otro tipo, un path que no existe, un
    path que atraviesa un array sin operador posicional, un `$[id]` sin `arrayFilters`, un
    identificador con mayúscula, una entrada de `arrayFilters` de un identificador que no está, un
    `$inc` en un string, un `$unset` de un campo obligatorio o con default, un `$currentDate` en un
    string, un `$push` en algo que no es array, un elemento de otro tipo, un `$pull` con un campo
    que el elemento no tiene, un `$rename` de un campo obligatorio, un operador que no existe y un
    pipeline.
  - Las reglas de uniones del prototipo se mantienen con todos los operadores: compila con el tipo
    fijado por igualdad, `$eq`, `$in` o dentro de `$and`, y falla sin fijarlo, con `$ne`, dentro de
    `$or` y al cambiar el discriminador; un `$setOnInsert` puede fijarlo. En los `arrayFilters` de
    `plugins`, `loginCustomerId` exige fijar `a.details.plugin`, y un índice no fija nada.
  - El driver rechaza un update vacío antes de mandarlo (`MongoInvalidArgumentError: Update
    document requires atomic operators`). Un `$set: {}` lo acepta el servidor.
  - Con 23 filtros y 11 updates como los reales de `plugins` y `blueprints` (con `$[connection]`,
    `$[account]` y `$[p]`), suman 118 mil instanciaciones, y el chequeo pasa de 0,047 s a 0,082 s.
    Con las sugerencias en la restricción, los mismos updates sumaban 495 mil.
  - El language server de TS 7 sugiere 143 paths en un `$set` de `blueprints`, 38 en un `$inc` de
    `plugins` y los 15 operadores. Las sugerencias se calculan con el parámetro de tipo sin
    inferir, así que tienen que estar en un tipo que no dependa del update.

- **Proyecciones en el paquete** (TypeScript 7.0.2, MongoDB 8.2.6 y 8 schemas de adsgpt):
  - Los casos del prototipo, portados a un schema como el de `plugins` de adsgpt: en cada uno, lo que
    responde el servidor es lo esperado y el tipo es idéntico. Inclusión con puntos y anidada, un
    campo de una opción de una unión, un padre `null`, `_id: 0`, `$`, `$slice`, `$elemMatch`,
    exclusión (da el schema público sin credenciales), `.project()` en el cursor, `findOneAndDelete`
    y una proyección que llega en runtime. No compilan las 14 proyecciones inválidas.
  - Con un índice de texto, `{ score: { $meta: 'textScore' } }` agrega `score: number`, y
    `sort: { score: { $meta: 'textScore' } }` ordena por relevancia con una key que no es un path.
  - Sin proyección, TypeScript infiere `{}` para su parámetro de tipo, no `unknown`; por eso una
    proyección sin keys devuelve el documento entero, como MongoDB.
  - Con 7 proyecciones sobre los schemas de adsgpt, `blueprints` incluido, suman 73 mil
    instanciaciones; el chequeo de los 41 llamados de las pruebas queda en 0,086 s. El language
    server sugiere 120 paths en la proyección de `blueprints`, en las opciones y en `.project()`.
  - Al comparar dos funciones, TypeScript borra los parámetros de tipo solo si alguna tiene varias
    firmas. Por eso las operaciones que devuelven documentos proyectados tienen, en la
    implementación, las dos firmas del driver (sin filtro y con filtro), y se comparan con la
    interfaz sin casts.

- **Tipos publicados** (TypeScript 5.5.4 y 7.0.2):
  - Un consumidor que importa `mongozod` desde `dist/` compila con las dos versiones, con
    `skipLibCheck: false`: los `.d.ts` de mongozod, Zod y el driver son válidos en TS 5.5. Los usos
    inválidos fallan en las dos con los mismos mensajes, como `"titel" is not a path of the document`
    o `"url" is not in every type allowed: fix "kind" in the filter`.
  - Como cualquier proyecto que use el driver 7, el consumidor necesita `@types/node` y la lib
    `ESNext.Disposable`: sus `.d.ts` usan módulos de Node.js y `Symbol.asyncDispose`.
  - TS 7 no trae `tsserver`, así que el alias de TS 5.5 deja el suyo en `node_modules/.bin`. El
    `tsc` sigue siendo el de TS 7.

- **Updates en runtime** (Zod 4.6.5, driver 7.7.0 y MongoDB 8.2.6, 16 tests):
  - MongoDB acepta `{}` en los 15 operadores, también en un upsert, que inserta el documento.
  - Un `replaceOne` con `upsert` inserta el reemplazo con el `_id` del filtro, también dentro de
    `$and`, y no copia ningún otro campo del filtro. Sin `_id` en el filtro, el servidor genera un
    `ObjectId`.
  - `_zod.bag` está vacío en los números enteros, y el formato vive en `def.format` o en un check
    interno. Zod clásico lo expone en el `format` de `z.number()`, calculado con `aggregateChecks`,
    que `zod/v4/core` no exporta; Zod Mini no lo expone (Zod 4.6.5). `0.5` da `invalid_type` con `expected: 'int'` en `z.number().int()`, `z.int()`,
    `z.int32()`, Mini y un entero opcional; un `.min()` sin `.int()` da otro error.
  - `_zod.optout` es `'optional'` en `.optional()`, y no en `.default()`, `.nullable()` ni un campo
    obligatorio.
  - `new z.ZodError(issues)` no es instancia de `Error` ni tiene stack; `new z.ZodRealError(issues)`,
    que es lo que lanza `z.parse`, es instancia de `Error`, de `ZodError` y de `$ZodError`.
  - En Zod 4, una key con `z.unknown()` es obligatoria en runtime: sin ella, `expected nonoptional`.
  - Los tests cubren los valores por path (un ISO llega como `Date`, un elemento entero con sus
    defaults), las keys en `undefined` (el campo conserva su valor en la base), cada regla por
    operador, las reglas de las uniones en la raíz y en `arrayFilters`, las keys con `.` o `$` en un
    record y en un `z.unknown()`, un pipeline, un upsert que insertaría un documento inválido (no
    escribe nada, tampoco en `bulkWrite`), uno que completa los defaults (el documento guardado
    cumple el schema, con su `_id` uuid) y uno sobre un documento existente, que no cambia sus
    campos. Los mensajes coinciden con los de los tipos.

- **`timestamps`** (código de Mongoose, driver 7.7.0, MongoDB 8.2.6 y TypeScript 5.5.4 y 7.0.2):
  - Mongoose, en `setDocumentTimestamps`, pone `createdAt` solo si el documento nuevo no lo tiene y
    le da a `updatedAt` ese mismo valor. En `applyTimestampsToUpdate`, pone `updatedAt` en `$set`,
    pisando el del update, borra cualquier `createdAt` del update y lo escribe en `$setOnInsert` solo
    en un upsert. En un reemplazo usa las fechas que trae, o «ahora».
  - Hoy, los `MongoModel` de los tres proyectos ponen `createdAt` en el insert solo si no viene, no
    ponen `updatedAt` en el insert, y en cada update escriben `$set.updatedAt` y
    `$setOnInsert.createdAt`.
  - 12 tests: el insert pone las dos fechas iguales, respeta las que vienen (un ISO de la fuente
    llega como `Date`) y usa la misma en todo un `insertMany`; `timestamps: false` deja los defaults
    del schema; un update cambia `updatedAt` y no `createdAt`; un upsert pone `createdAt`, o respeta
    el de `$setOnInsert`; escribir `updatedAt` o `createdAt` no compila y lanza, salvo con
    `timestamps: false`; `bulkWrite` estampa inserts y updates; los nombres se cambian o se apagan; y
    un schema sin el campo, con otro tipo o sin el campo en un tipo de una unión no compila y lanza
    al definir el modelo.
  - Sin `.default()` (TypeScript 5.5.4 y 7.0.2, 14 tests): un insert, un reemplazo y el insert de
    un `bulkWrite` compilan sin las fechas, y el editor las sugiere como opcionales; con
    `timestamps: false` no compilan sin ellas y el schema lanza un `ZodError`, salvo que tengan un
    `.default()`; una opción mal escrita sigue sin compilar. El consumidor de los `.d.ts` compila con
    `date()` sin default, y su costo de tipos casi no cambia (304.474 instanciaciones contra
    303.618).
  - El consumidor de los `.d.ts` publicados compila un modelo con timestamps con TS 5.5 y 7.

- **Referencias y virtuals** (driver 7.7.0, MongoDB 8.2.6, Zod 4.6.5, TypeScript 5.5.4 y 7.0.2, y
  los tres proyectos):
  - Hoy, `populate` se usa en 8 llamadas de adsgpt, todas con el `input.populate` de un `find` o un
    `findOne`; en 39 de wortise-dashboard-monorepo, de las cuales 3 están escritas en el servidor y 6
    las manda el cliente; y en ninguna de app-maker. Todas las referencias guardan un id, salvo
    `advertisers` en las cuentas de wortise-dashboard-monorepo, que no se popula. Ninguna usa paths
    con punto ni otro campo que el `_id`.
  - `MongoModel` lee la colección referenciada directamente: no aplica el soft delete del destino
    ni sus virtuals, y un documento que falta deja el id. campaign-reports de
    wortise-dashboard-monorepo responde NOT_FOUND con `typeof campaign !== 'string'`.
  - Mongoose deja `null` cuando el documento referenciado no existe, y quita los que faltan de un
    array.
  - El driver lee un lote con `hasNext()`, que trae el siguiente cuando no quedan documentos, y
    `readBufferedDocuments()`. Un `findOneAnd…` sin `includeResultMetadata` devuelve el `value` del
    `ModifyResult`, o `null`.
  - Dos modelos que se referencian, uno que se referencia a sí mismo, o uno con dos referencias al
    mismo modelo dan `TS7022` en TypeScript 7 si `references` restringe el tipo del destino, aunque
    sea a `() => unknown`. Con el valor sin restringir compilan, en los `.d.ts` publicados también
    con TS 5.5.
  - `schema.pick(…).transform(…)` de Zod y `z.pipe(z.pick(…), z.transform(…))` de Zod Mini guardan el
    objeto que toman en el `in` del pipe.
  - 14 tests de virtuals: una lectura los agrega, también en `findOne`, en un `findOneAnd…` y en un
    `for await` por lotes; una proyección que pide uno trae sus campos y devuelve solo lo pedido,
    con o sin `_id`; una exclusión lo quita si deja afuera un campo que lee, o una parte; pedirlo y
    cambiar un campo que lee no compila y lanza; un documento inválido lanza un `ZodError`; no está
    en el `document` de un insert; no se filtra, ordena ni escribe; y un nombre de campo, un campo
    que falta, otro tipo, un schema que no toma un objeto o un campo que falta en un tipo de una
    unión no compilan, y los que se pueden ver en runtime lanzan al definir el modelo.
  - 18 tests de referencias: `populate` a otro modelo aplica sus virtuals, y a una colección con su
    schema lee esa colección; `true` trae el documento entero; un faltante queda en `null` y un array
    guarda los encontrados; un `_id: 0` en la proyección del destino funciona; anda en los
    `findOneAnd…` y entre dos modelos que se referencian; una inclusión trae la referencia y una
    exclusión que la excluye no compila y lanza; hace una consulta `$in` por lote y cierra el cursor
    si el loop corta antes; ve las escrituras de la transacción de la lectura; un `populate` de
    runtime deja la unión con el id; una key que no es referencia lanza un `ZodError`; y una
    referencia que no es un campo, un destino inválido o un campo con otro tipo que el `_id` del
    destino no compilan.
  - Costo de tipos en un consumidor de las declaraciones: el mismo uso de antes pasa de 35,7 mil a
    36,5 mil instanciaciones, con el mismo tiempo de chequeo. Dos modelos con virtuals y referencias y
    seis llamadas suman 11 mil más y 5 ms.

- **`sync()` y `$jsonSchema`** (MongoDB 8.2.6, driver 7.7.0, Zod 4.6.5, TypeScript 5.5.4 y 7.0.2, y
  los tres proyectos):
  - Hoy los tres `MongoModel` crean los índices en la primera operación y comparan solo las claves,
    con `JSON.stringify`: ignoran los que difieren en las opciones y no informan los que sobran.
    adsgpt y wortise-dashboard-monorepo los declaran como `{ key, options }` y app-maker con la
    forma del driver. El driver de wortise descarta `options`, así que el `unique` de waitlists
    nunca se creó, y su bandera estática hace que solo el primer modelo de cada proceso cree los
    suyos. Las opciones que se usan son `unique` y `expireAfterSeconds`, sobre campos de primer
    nivel. Ninguno usa `$jsonSchema`.
  - Crear de nuevo un índice idéntico devuelve su nombre y no hace nada. Con la misma clave y otro
    nombre falla con el código 85 («Index already exists with a different name: a_1»); con el mismo
    nombre y otras opciones u otra clave, con el 85 o el 86, con los dos índices en el mensaje. Con
    otro nombre y otras opciones crea un segundo índice. `createIndexes` es atómico: si uno falla,
    no crea ninguno.
  - `listIndexes` y `collMod` sobre una colección que no existe fallan con el código 26. Un índice de
    texto se lista con la clave `{ _fts: 'text', _ftsx: 1 }`. Un índice parcial acepta una igualdad
    con `null` y `$in`, y rechaza `$ne` con el código 67.
  - El `$jsonSchema` es el draft 4 sin `$ref`, `$schema`, `default`, `definitions`, `format`, `id`,
    el tipo `integer` ni keywords desconocidas, según el manual: `format` y `default` fallan con el
    código 9. Acepta `anyOf` en la raíz, el alias `number` y `\p{L}` en un `pattern`. Con
    `additionalProperties: false` y sin `_id` en las propiedades, rechaza todo insert.
  - Un `.transform()` no dice qué devuelve, así que una fecha con transform queda sin regla: así
    quedaban todas las fechas de los 18 schemas de adsgpt. Un codec (`z.codec`, desde Zod 4.1) y un
    `.pipe(z.date())` declaran la salida, y dan `date`. La documentación de Zod tiene el ejemplo
    `isoDatetimeToDate`, y un transform no se puede encodear.
  - Cada llamada al getter de `z.json()` crea un schema nuevo, así que un recorrido que lo llama no lo
    reconoce: `mongozod()` desbordaba la pila con un campo `z.json()`. `innerType`, documentado como
    la forma cacheada de leerlo, devuelve siempre el mismo.
  - MongoDB 8.2 acepta los `$jsonSchema` generados para los 18 schemas de adsgpt.
  - 7 tests del generador (tipos BSON, obligatorios, anidados, uniones, nullables, records, tuplas,
    pipes y codecs, lo que queda sin regla, objetos estrictos o abiertos, Zod Mini) y 10 de `sync()`:
    crea los índices y devuelve sus nombres, con un `unique` parcial; devuelve los que sobran sin
    borrarlos; falla con el 86 cuando uno difiere; anda sin colección; una clave que no es un path no
    compila y lanza al definir el modelo, y un `partialFilterExpression` con otro tipo no compila; crea la colección con el validador, que
    rechaza un `$set` con punto que crea un padre incompleto; reemplaza el validador con el nivel
    pedido; acepta un documento complejo que escribe la app; valida cada tipo de una unión; y no toca
    el validador de un modelo que no lo pide.
  - Tres índices en un modelo cuestan 2 mil instanciaciones y 4 ms en un consumidor de las
    declaraciones. El consumidor de los `.d.ts` publicados compila `indexes`, `jsonSchema`, `sync()`
    y el codec de fechas con TS 5.5 y 7.
  - Sugerencias del editor, con el language service de TypeScript 5.5: con `indexes` como array, ni
    con `mongozod(schema, { indexes })`, ni con un callback que devuelve el array, el editor sugiere
    los paths, porque el schema y los índices se infieren del mismo objeto; un array sin genérico
    los sugiere, pero pierde los paths profundos y el chequeo del filtro parcial. Con
    `indexes: (index) => [index(key, options)]` sugiere los paths de la clave, los comodines y los
    paths y operadores del `partialFilterExpression`, en cualquier orden de las opciones, y los
    chequeos siguen andando.

- **Contrato de plugins** (TypeScript 5.5.4 y 7.0.2, MongoDB 8.2.6 y los tres proyectos):
  - Ninguno de los tres `MongoModel` tiene hooks, plugins, auditoría ni historial: el `before` solo
    inicializa y el `after` solo hidrata. adsgpt y wortise-dashboard-monorepo arman el actor en un
    middleware de tRPC (`scope.mutation` con `createdBy` y `updatedBy`), y los routers lo esparcen en
    cada escritura.
  - Un `before` de grupo que devuelve `{ args }` con el filtro cambiado no compila si el tipo del
    retorno se distribuye por operación; sin distribuir, compila para todo el grupo.
  - Un plugin con contexto no es asignable a `Plugin<…GroupSchemas…>`: TypeScript compara el
    parámetro del contexto por varianza. Con los hooks y el `middleware` como métodos, y un
    `AnyPlugin` que no depende de los genéricos, cualquier plugin entra.
  - Un modelo con `_id` string no es asignable a un modelo con los resultados del driver para
    `Document`, que tipan `insertedIds` y `upsertedId` como `ObjectId`; `AnyModel` usa resultados con
    el `_id` como `unknown`.
  - Un `definePlugin` escrito dentro de `plugins: [...]` infería sus genéricos desde el tipo que
    espera `mongozod()`; con `NoInfer` en su retorno, los infiere solo de su definición.
  - Dos modelos con plugins, con contexto en las escrituras y un método genérico por `this`,
    compilan en los `.d.ts` publicados con TS 5.5 y 7. El mismo uso de antes pasa de 48,5 mil a 50,2
    mil instanciaciones en un consumidor de las declaraciones, y de 38 a 41 ms.
  - 14 tests: las capas y el orden de los hooks de grupo y de operación; un `before` que cambia los
    argumentos y un `after` que cambia el resultado; el atajo de un `before`, con los `after` de las
    capas que entraron; un hook que despacha otra operación por todos los plugins; `aggregate` y
    `estimatedDocumentCount` sin grupo; los `before` de un cursor una vez y el `middleware` por
    lote; los modificadores del cursor que ven los `before`, y que lanzan después de arrancar; el
    contexto propio de cada plugin, obligatorio y validado; una opción de plugin validada y
    quitada antes del driver; un método tipado por el modelo; y los chequeos de campos, métodos y
    opciones, que no compilan y lanzan.

- **`softDelete`** (MongoDB 8.2.6, TypeScript 5.5.4 y 7.0.2, y los tres proyectos):
  - En los tres proyectos, un documento vivo no tiene `deletedAt`. adsgpt y
    wortise-dashboard-monorepo excluyen los borrados solo en `find`, `findOne` y `distinct`, con
    `filter.deletedAt ??=`, que no ve una condición dentro de `$and`; su `count`, sus updates y su
    `bulkWrite` incluyen los borrados, y sus services vuelven a agregar el filtro a mano. app-maker
    lo aplica solo en `find`, con `includeDeleted`, y restaura con `$unset` y un `restoredAt` propio.
    Los `MongoModel` de adsgpt y wortise no le pasan la sesión al driver en `find`, `findOne` y los
    borrados: las transacciones de wortise no los incluyen.
  - adsgpt declara `deletedAt` como la unión de una fecha y un ISO con transform, opcional, y
    app-maker como `z.coerce.date().optional()`: los dos son compatibles con el
    `z.date().optional()` que pide el plugin.
  - 13 tests: lecturas sin los borrados, la papelera y todos con filtros, también dentro de `$and`;
    `aggregate` y `estimatedDocumentCount` sin tocar; un borrado que marca con un update, que
    completa `updatedAt` y no marca dos veces; el borrado real y el vaciado de la papelera;
    `findOneAndDelete` con el documento anterior; updates que no tocan borrados y una restauración;
    un upsert sobre el `_id` de un borrado que falla por clave duplicada; `bulkWrite` con las mismas
    reglas; un índice único con `deletedAt: null` que libera la clave; `populate` con `null` para un
    borrado; el update del borrado con el contexto de la llamada; y un schema sin `deletedAt`, que
    no compila y lanza.
  - El subpath `mongozod/plugins/soft-delete` pasa attw y publint, y el consumidor de los `.d.ts`
    publicados lo importa con TS 5.5 y 7.

- **`mz`** (MongoDB 8.2.6, Zod 4.6.5, TypeScript 5.5.4 y 7.0.2, y los tres proyectos):
  - Hoy los clientes de los tres proyectos filtran con igualdades, arrays que el `parser` convierte
    en `$in`, `{ exists }` y rangos de fechas con `$gte` y `$lte`, también con paths con punto. Los
    updates mandan campos enteros, y wortise manda `null` para borrar 8 campos. Las tablas ordenan
    por una sola columna, las proyecciones solo incluyen, `populate` lo mandan 5 llamadas de
    wortise, y el scroll infinito manda el número de página. Solo la audiencia de notificaciones de
    wortise manda `$and` y `$or`, con un `MongoQuerySchema` que acepta cualquier campo. En
    app-maker, `pick({ _id: true }).required()` convierte un `{}` en un uuid nuevo.
  - En MongoDB, un orden descendente deja al final los documentos con `null` o sin el campo, y un
    `$lt` sobre una fecha no los alcanza. Un `$or` con índices en todas sus cláusulas usa un `OR` de
    `IXSCAN`, y con una cláusula sin índice, un `COLLSCAN`. El driver rechaza un update `{}` con
    `MongoInvalidArgumentError`, y `{ $set: {} }` coincide con el documento y no lo modifica.
  - En Zod, un `z.object` devuelve sus keys en el orden del schema: `{ title: 1, createdAt: -1 }`
    sale como `{ createdAt: -1, title: 1 }`. `z.partialRecord` conserva el orden del input y
    rechaza las keys no declaradas. Un `ZodDefault` deja opcional su key en `z.input`, y un
    `ZodType` declarado como retorno no. `.overwrite()` conserva la clase `ZodObject`, y sobre un
    objeto con checks andan `.required()`, `.refine()`, `.default()` y `.extend()` con keys nuevas,
    mientras que `.pick()`, `.omit()` y `.partial()` lanzan. Un `.refine()` con `when` no repite el
    mensaje de otro problema. `.extend()` con getters arma un `$or` recursivo sin anotaciones de
    tipos, con TypeScript 5.5 y 7.
  - En tRPC 11.19, el `initialPageParam` de una infinite query es el `initialCursor` o el `cursor`
    del input, y la key `cursor` solo viaja cuando la página tiene uno: la primera página no lo
    manda. tRPC también suma `direction` al input.
  - En TypeScript, un array inferido como genérico no da sugerencias en el editor y un path mal
    escrito pierde el mensaje (`Type 'string' is not assignable to type 'never'`); una máscara como
    la de `.pick()` sí los da, comprobado con el language service de TypeScript 5.5. Los tipos no
    ven el orden de las keys de un objeto. Un `$elemMatch` o un `$not` opcionales, como los de un
    tipo que llega de un input, no compilaban en los filtros del modelo, porque su condición se
    distribuía sobre `undefined`; ahora compilan.
  - 31 tests: los operadores declarados, el parseo de cada valor y lo que se rechaza; las keys en
    `undefined`; la igualdad, `$all`, `$size` y `$elemMatch` en arrays de objetos y de valores;
    `.default()`, `.required()`, `.refine()` y `.extend()` con `$or`; Zod Mini y una unión
    discriminada; un update sin defaults, con las reglas de `$unset` e `$inc`; el orden del sort;
    una proyección sin mezclar; un cursor que recorre 7 documentos, 4 con la misma fecha, ordenados
    por fecha, título y `_id`, en páginas de 3, sin repetir ni saltear; `populate` con la lista
    blanca; y las declaraciones inválidas, que no compilan y lanzan. Cada constructor pasa su
    resultado al modelo, en MongoDB.
  - `dist/mz.mjs` solo importa `zod` en runtime; sus declaraciones importan tipos de `mongodb` a
    través de un chunk compartido con el modelo. El subpath pasa attw y publint, y el consumidor de
    los `.d.ts` publicados lo usa con TypeScript 5.5 y 7.
  - Costo: tres schemas de inputs y su router suman 24 mil instanciaciones y 16 ms al consumidor de
    los `.d.ts`. Con el `blueprints` de adsgpt, cada constructor suma entre 11 y 25 mil, sin
    `TS2589`, y el chequeo queda entre 0,12 y 0,16 s. Unos 11 mil son el recorrido de los paths
    para las sugerencias, el mismo que hace el modelo.

- **Reemplazo de Mongoose** (driver 6.20.0 y 7.7.0, bson 7.3.3, Zod 4.6.5, y la documentación y
  el código de Mongoose):
  - Con el driver 6.20.0, el que usa Mongoose desde la 8.19 (`mongodb ~6.20.0`; la 8.18 usa `~6.18.0`, verificado en npm el 2026-10-12), mongozod compila sin errores y
    pasan los 194 tests, el build, attw, publint y el consumidor de los `.d.ts` con TS 5.5 y 7. Los
    tipos que importa del driver tienen la misma forma en los dos majors; en 6.20, `findOne` además
    acepta `limit`, `batchSize` y `noCursorTimeout`. Cada driver trae su bson: 6.10.4 el 6.20, y el
    serializador de bson lanza `Unsupported BSON version` con un valor de otro major.
  - Formas de validar un `ObjectId`: `z.instanceof(ObjectId)` rechaza el hex; un regex con
    `.transform()` rechaza un `ObjectId` y tipa el insert como `string`; la unión con
    `.transform()` acepta los dos y `mz.filter` convierte el hex. Con transform, `z.encode` lanza
    `Encountered unidirectional transform during encode`, y las tres generan `{}` en el
    `$jsonSchema`. La página de codecs de Zod no trae uno de `ObjectId`.
  - bson 7 rechaza un string de 12 caracteres en `new ObjectId()`, y `ObjectId.isValid` le da
    `false`. Su símbolo público `bsonType` es `Symbol.for('@@mdb.bson.type')`, pero bson 6.10 no lo
    tiene; `_bsontype` es público en los dos. `mongodb` reexporta el `ObjectId` de `bson`.
  - En Node, el `ObjectId` del build CommonJS de bson 7.3.3, el que carga el driver, no es la misma
    clase que el del build ES: `instanceof` falla aunque la versión sea la misma.
  - `objectId()` (bson 7.3.3 y 6.10.4, 7 tests): toma el hex, en mayúsculas o minúsculas, y un
    `ObjectId` de cualquiera de los dos builds; rechaza lo demás con un solo issue; `z.encode` da el
    hex solo con el codec primero en la unión (con el `ObjectId` primero lo devuelve sin cambios);
    el `$jsonSchema` lo da como `objectId`; y el modelo guarda un `ObjectId` desde un hex, desde
    `mz.filter` y desde `mz.update`. Con el driver 6.20 y bson 6.10.4 pasan los 203 tests, los
    tipos, el build y el consumidor de los `.d.ts`. Lo mismo vale para las fechas:
    `z.union([z.date(), isoToDate])` no encodea, y `z.union([isoToDate, z.date()])` sí.
  - `date()` (Zod 4.6.5, 5 tests): toma una `Date` y un ISO con `Z` o con zona horaria, que llegan
    al mismo instante; rechaza con un solo issue un ISO sin zona horaria, una fecha sin hora, una
    `Date` inválida y lo demás; `z.encode` da el ISO en UTC; el `$jsonSchema` lo da como `date`; y
    el modelo guarda una `Date` desde un ISO con zona horaria, que `mz.filter` también convierte en
    un `$lt`. `dist/codecs/date.mjs` no importa `bson`. La documentación de Zod dice que sus codecs
    no son API, sino implementaciones para copiar y adaptar.
  - Mongoose 9 rechaza por defecto los updates con pipeline y pide `updatePipeline: true`, por
    query o global (guía de migración a la 9). En un pipeline, su `applyTimestampsToUpdate` agrega
    `{ $set: { [updatedAt]: now } }` y no escribe `createdAt`.
  - Updates con pipeline (MongoDB 8.2.6, TypeScript 5.5.4 y 7.0.2, 6 tests): `$add` calcula un
    campo con `updatePipeline: true`; sin la opción no compila y lanza un `ZodError`, también en
    `bulkWrite`; un `$match` no compila y el servidor lo rechaza con un `MongoServerError`;
    `timestamps` actualiza `updatedAt`, y en un upsert el documento existente conserva su
    `createdAt` y el insertado recibe uno igual a su `updatedAt`; `softDelete` deja afuera los
    borrados (`modifiedCount` 1 de 2); y funcionan en `findOneAndUpdate` y `bulkWrite`. Los
    mensajes de los tipos nombran la opción o las etapas que se aceptan.
  - Opciones de `populate` (MongoDB 8.2.6, TypeScript 5.5.4 y 7.0.2, 3 tests nuevos): `filter` deja
    en `null` una referencia simple y saca de un array las que no cumplen, también con una colección
    sin modelo; `sort` ordena un array, que sin `sort` conserva el orden guardado; una opción
    desconocida o que no es un objeto lanza un `ZodError` con su path. El editor sugiere las
    referencias, las opciones y los paths del destino en `filter`, `projection` y `sort`, y un path
    que no existe da `"nickname" is not a path of the document`. Con `ReadOf` dentro de un argumento,
    la unión `true | { projection }` de un `populate` que llega en runtime mezclaba las dos
    proyecciones; distribuida en el nivel de arriba, da una unión de las dos lecturas.
  - Referencias dentro de objetos y arrays (MongoDB 8.2.6, TypeScript 5.5.4 y 7.0.2, 3 tests
    nuevos): `items.product`, `items.alternatives` (un array de ids dentro de un array) y
    `shipping.carrier` se reemplazan en cada elemento y objeto, con una consulta `find` por
    referencia, y un faltante queda en `null` dentro del elemento; el tipo de la lectura sigue cada
    path, con el objeto opcional que falta; una inclusión de `items` o de `items.qty` trae la
    referencia sin colisión de paths, y una exclusión de `items` no compila y lanza un `ZodError`;
    `items.0.product` no compila y lanza un `Error`. El editor sugiere los paths en `populate`; en
    `references` no sugería ni antes los campos de primer nivel. El costo de tipos del consumidor
    sube de 302.954 a 308.572 instanciaciones (1,9 %), porque `references` toma los paths del
    schema.
  - Un modelo con un campo `z.json()` no compilaba en un `find` (`TS2589`, ya en la fase 4): las
    sugerencias de paths recorrían su unión recursiva sin sumar profundidad. Ahora cada unión suma
    un nivel, y las sugerencias de los arrays de objetos no cambian.
  - `populate` anidado (MongoDB 8.2.6, TypeScript 5.5.4 y 7.0.2, 2 tests nuevos): tres niveles,
    de un movimiento a su cuenta, a su último movimiento y a su organización, con modelos que se
    referencian entre sí; el tipo de cada nivel sigue su `populate` y su proyección; un `populate`
    en una colección sin modelo y una referencia que el destino no tiene no compilan y lanzan un
    `ZodError`. El editor sugiere las referencias y las opciones del destino en cada nivel, también
    entre dos modelos que se referencian. El costo de tipos del consumidor no cambia (308.448
    instanciaciones).
  - Uno a muchos (MongoDB 8.2.6, TypeScript 5.5.4 y 7.0.2, 5 tests nuevos): los posts de cada autor
    por `author`, los de un array `coauthors` y los comentarios por un `localField` propio
    (`handle`), en arrays vacíos cuando no hay; `filter`, `sort`, `projection` y un `populate`
    anidado funcionan como en las demás referencias, y la proyección del destino que deja afuera
    el `foreignField` no lo devuelve; una lectura con `{ _id: 0, name: 1 }` pide el `_id`, puebla y
    lo quita, y su tipo tampoco lo tiene; una key que es un campo, un `localField` que no existe y
    un `foreignField` que no es un path del destino no compilan y lanzan; poblar el `foreignField`
    en un `populate` anidado no compila y lanza un `ZodError`. Para aceptar una key que no es un
    path, `references` toma cualquier key, y `UnknownReferences` da el error de las que no
    corresponden: `"ownr" is not a path of the schema`. El editor sugiere la key y las opciones. El
    costo de tipos del consumidor queda en 308.862 instanciaciones.
- **Estructura y tree shaking** (rolldown 1.2.13, Zod 4.6.5, Node 22):
  - Con el objeto `mz`, un bundle que usa solo `mz.sort` pesaba 14.031 bytes, lo mismo que uno que
    usa todo `mz`, con `filter` adentro. Con exports con nombre e `import * as mz`, el del `dist`
    pesa 3.434 bytes, sin `filter`. Exportar además el namespace con nombre, como hace Zod
    (`export * as mz`), no sirve: `import { mz }` pesa 14.468 bytes, con `filter`, porque rolldown
    arma el objeto del namespace. Zod exporta `z` así en `zod` (`export { z, z as default }`, junto
    a `export *`), y su README importa con `import * as z`.
  - En un proyecto sin `bson`, `mongozod/codecs/date` funciona y `mongozod/codecs/bson` falla al
    importarse con `ERR_MODULE_NOT_FOUND: Cannot find package 'bson'`; solo `dist/codecs/bson.mjs`
    importa `bson`. Con npm, el `bson` del driver queda arriba en `node_modules` y suele
    encontrarse; con pnpm hay que instalarlo.
  - Zod clásico tiene `.unwrap()` en cada wrapper, de a un nivel, y el de `z.lazy` llama al getter,
    que en `z.json()` arma un schema nuevo cada vez. Zod Mini no tiene `.unwrap()` y `zod/v4/core`
    no exporta un equivalente, así que `unwrapSchema` sigue: recorre todos los wrappers con
    `_zod.def.innerType` y los lazies con `_zod.innerType`. `z.exactOptional` es instancia de
    `$ZodOptional`, así que ya lo cubre.
  - Mover los 49 archivos a carpetas por tema no cambió los tests (229), el build ni los `.d.ts`.
- **`bsonType` en la metadata de Zod** (Zod 4.6.5, MongoDB 8.2.6, TypeScript 5.5.4 y 7.0.2, 2 tests
  nuevos):
  - `.meta()` de Zod clásico y `z.meta()` de Mini guardan la metadata en `globalRegistry`, cuyo
    `get` hereda la de la copia original: `z.number().meta({ bsonType: 'int' }).min(0)` la conserva.
    El driver exporta los alias como `BSONTypeAlias`; `number` es un alias del `$jsonSchema` que no
    está ahí.
  - El `$jsonSchema` da `decimal` a un `Decimal128` declarado, en los dos órdenes con
    `.nullable()`, en Mini y como opción de una `z.union`; sin metadata sigue sin regla. Con
    `jsonSchema: true`, MongoDB acepta un `Decimal128` y rechaza un número en ese campo (código 121).
  - Costo de tipos, con el mismo consumidor de los `.d.ts`: 309.763 instanciaciones sin la
    augmentation, 315.543 con `string`, 335.622 con los alias y 360.024 con alias o arrays de alias.
    Se eligió el alias. El editor sugiere los alias dentro de `.meta({ bsonType })`.
- **`decimal128()`** (bson 7.3.3 y 6.10.0, MongoDB 8.2.6, 4 tests): `Decimal128.fromString` toma
  `'10.50'`, `'-1E+3'`, `'NaN'` e `'Infinity'`, y lanza un `BSONError` con `'abc'`, `'1.2.3'`,
  `' 10'`, `''`, un overflow y un string de más de 34 dígitos, que redondearía; `BSONError.isBSONError`
  lo reconoce, en bson 7 y 6. `JSON.stringify` de un `Decimal128` da `{ $numberDecimal }`. El codec
  toma el `Decimal128` de los dos builds de bson y rechaza un número; `z.encode` da el string; el
  `$jsonSchema` da `decimal`; y el modelo guarda un `Decimal128` desde un string, que `mz.filter`
  también convierte en un `$gte`.
  - De número a `Decimal128` con `String(n)`: `10.5`, `0.1` y `19.99 * 3` (`59.97`) quedan
    exactos; `0.1 + 0.2` da `0.30000000000000004`, y `JSON.parse('12345678901234567.89')` da
    `12345678901234568`. Con hasta 15 dígitos significativos, o un entero seguro, el número es el
    decimal que se escribió. En una unión de Zod que falla, la opción del mismo tipo devuelve su
    propio issue, pero una unión de afuera lo reemplaza por el suyo.
- **`binary()`** (MongoDB 8.2.6, bson 7.3.3 y 6.10.0, TypeScript 5.5.4 y 7.0.2, 4 tests):
  - El driver guarda un `Uint8Array` y un `Buffer` como `binData` subtipo 0 y los lee como `Binary`,
    no como `Uint8Array`. Con `promoteBuffers: true`, en la consulta o en el cliente, lee como
    `Buffer` todos los binarios: el genérico, un MD5 (subtipo 5) y un UUID.
  - `Binary` expone `value()`, `sub_type`, `toString('base64')` y `createFromBase64`, en bson 7 y 6.
  - El codec toma base64, un `Uint8Array`, un `Buffer` y el `Binary` de los dos builds de bson; un
    MD5 y un UUID pasan tal cual; rechaza un base64 inválido con su mensaje; `z.encode` da base64;
    el `$jsonSchema` da `binData`; y un documento leído se reemplaza tal cual.
  - TypeScript 7 emitía `Uint8Array<ArrayBufferLike>` en el `.d.ts`, y TypeScript 5.5 lo rechaza
    (`Type 'Uint8Array' is not generic`); con el tipo de retorno escrito, emite `Uint8Array`.
- **GeoJSON** (MongoDB 8.2.6, el manual de GeoJSON de MongoDB y el RFC 7946, 4 tests):
  - Con un índice `2dsphere`, MongoDB acepta un `Point` con altitud y hasta con cuatro valores, una
    línea de dos posiciones, un polígono con un hueco, un `MultiPoint`, un `MultiPolygon` y un
    miembro de más, como `bbox`. Rechaza (código 16755) una longitud de 181, una latitud de 91, un
    `Point` de un valor, una línea de una posición o de dos iguales, un anillo abierto o de tres
    posiciones, un polígono que se cruza a sí mismo y un polígono o un `MultiPoint` vacíos. El
    manual no dice el mínimo de una línea ni si se acepta la altitud.
  - Los schemas toman cada tipo, con altitud opcional; rechazan con su mensaje los rangos, la línea
    degenerada, el anillo abierto o corto y las geometrías vacías; el `$jsonSchema` los describe como
    objetos y tuplas; y un modelo con índice `2dsphere` los guarda y los encuentra con `$near`.
  - MongoDB rechaza (16755) una `GeometryCollection` vacía, una anidada y una con una geometría
    inválida, y acepta una de un `Point` y un `LineString`. `mz.geometryCollection()` hace lo mismo.
- **Los tipos de campo en `mongozod/mzod`** (rolldown 1.2.13, la documentación de npm y pnpm):
  - Con un sub-namespace (`export * as query`), un bundle que usa `mz.query.sort` pesa 3.611 bytes,
    sin `filter`, lo mismo que plano.
  - npm instala los peers obligatorios desde la 7 y no los opcionales; pnpm, con
    `autoInstallPeers` (activo por defecto), instala los obligatorios que faltan. Yarn no: su léxico
    dice que el paquete que depende de otro tiene que proveer él mismo sus peers.
  - Con el build en un archivo por entry, un cliente que usa `mz.sort` y `mz.date` cargaba `bson`
    (108.800 bytes): el codec de `mz.decimal128()` se arma al cargar el módulo, con un `.refine()`
    que el bundler no puede quitar. Con `unbundle`, un archivo por módulo, pesa 4.698 bytes, sin
    `bson` ni `filter`; `mz.sort` solo, 3.553; y `mz.objectId()` carga `bson` (104.338). El paquete
    pasa de 12 archivos y 61,2 KB a 76 archivos y 65,7 KB. `bson` no declara `sideEffects`.
  - Populate de Mongoose (su documentación): `match` deja en `null` una referencia que no cumple y
    saca las de un array; `limit` no es por documento, porque consulta con `numDocuments * limit`;
    `perDocumentLimit` hace una consulta por documento; `refPath` elige el modelo con otro campo del
    documento; el virtual populate usa `localField` y `foreignField`, y `count` devuelve la
    cantidad.

- **Herramientas del repo** (pnpm 12.11.2, Node 22.23.2, Bun 1.4.3):
  - Vitest 5, tsdown 0.23 y Changesets 3 piden Node 22.12 o superior, y Node 20 llegó al final de su
    vida el 2026-04-30. El driver 7 todavía acepta Node 20.19.
  - Vitest corre con `bun --bun` dentro de Bun (`typeof Bun` es `object`) contra el replica set de
    mongodb-memory-server con MongoDB 8.2.6, y una transacción con `withTransaction` funciona. Bun
    1.3.13 fallaba al importar `bson` 7.3 (oven-sh/bun#32501, cerrado); 1.4.3 ya no.
  - tsdown emite los `.d.ts` con TypeScript 7.0.2 a través de tsgo, y attw y publint no encuentran
    problemas en el tarball.
  - El lint con tipos marca una promesa sin `await` (`no-floating-promises`) y un `as`.

- **El costo de los tipos** (TypeScript 7.0.2, 6.0.3 y 5.5.4):
  - Los once cambios de [Costo de los tipos](./types.md#costo-de-los-tipos) no cambian lo que
    compila: los 206 errores de los tests, compilados sin sus `@ts-expect-error`, dan el mismo texto
    después de cada cambio. Un archivo de casos borde, con y sin `exactOptionalPropertyTypes`, da los
    mismos errores en las mismas líneas con TypeScript 7 y 5.5; solo cambia el texto del error de una
    entrada de `arrayFilters` que no es un documento.
  - Las sugerencias del editor son las mismas en 40 posiciones, con el language service de
    TypeScript 5.5 y con la API de TypeScript 7 (`typescript/unstable/sync`).
  - Intersectar la lista que declara `mz.filter` con su sugerencia hace que TypeScript compare cada
    método de los dos arrays: sin esa intersección, un `mz.filter` de cuatro paths baja de 8.971 a
    4.708 instanciaciones con TypeScript 7.
  - `Pick<T, K> extends Required<Pick<T, K>>` costaba 6.103 instanciaciones del proyecto típico con
    TypeScript 5.5, que reinstancia el output de Zod en cada key.
  - TypeScript 6.0.3 cuenta casi como TypeScript 7 (81.013 contra 80.739) y es JavaScript: una copia
    instrumentada sirve para atribuir el costo de TypeScript 7, que no tiene API de JS.
  - TypeScript corta con TS2589 a los 100 niveles de anidamiento o a los 5 millones de
    instanciaciones por expresión; la llamada más cara del proyecto típico ronda las 10 mil.

- **Lo que encontró la documentación de usuario** (MongoDB 8.2.6, driver 7.7.0, Zod 4.6.5,
  TypeScript 5.5.4 y 7.0.2): cada punto, con un test que fallaba antes de su arreglo.
  - Una proyección que pide solo un virtual que lee el `_id`, `{ id: 1 }`, llegaba al servidor como
    `{}` y devolvía todo el documento; con `{ _id: 0, id: 1 }`, todo menos el `_id`. Ahora llega
    como `{ _id: 1 }`, que MongoDB lee como una inclusión.
  - `$inc: { 'reactions.$x': 1 }` y `$set` sobre la key `$x` de un record o de un catchall pasaban
    la validación, y MongoDB 8.2 guarda `$x`, como lo guarda con el driver solo; el insert de
    `{ reactions: { $x: 1 } }` ya se rechazaba. Ahora un segmento con `$` que no es posicional no
    compila y lanza un `ZodError` con el mismo mensaje que en un valor, también en el destino de un
    `$rename`.
  - `aggregate(pipeline, { schema })` validaba con `z.parse`, y un refinement async lanzaba el
    `$ZodAsyncError` de Zod. Ahora cada lote se valida con `z.parseAsync`, como las escrituras.
  - Una función con `<const S extends SortOf<typeof M, S>>(sort: S)` no podía pasarle el sort al
    modelo: TS2322 en las opciones de `find` y `findOne`, y TS2345 en `.sort()`, con TypeScript 7 y
    5.5. El `NotAString` del parámetro quedaba sin resolver sobre el genérico. Con la unión con
    `object` compila, y los mensajes y las sugerencias de un sort, una proyección o un `populate` en
    un string son los mismos; agregarlo a `SortOf` daba TS2313.
  - Esparcir `...options: UpdateOptionsArg<typeof M>` en un update daba TS2345 en todos los modelos
    probados, con y sin `timestamps` o `softDelete`, en `updateOne` y `updateMany`, y con TypeScript
    7 y 5.5: el chequeo de `arrayFilters` recorría el `readonly Document[]` de las opciones como un
    objeto, con `length` y `toString`. No apareció el caso que había compilado.
  - Un plugin con una opción `updatePipeline` compilaba y `mongozod()` lanzaba: la lista de runtime
    de las opciones de mongozod la tenía, y el tipo no. Ahora no compila.
  - Un reemplazo sin `updatedAt` tomaba el valor de su `createdAt`: el que conservaba el `createdAt`
    del documento guardaba como `updatedAt` la fecha de creación. Ahora toma la fecha de la
    escritura, como Mongoose, en `replaceOne`, `findOneAndReplace` y el `replaceOne` de
    `bulkWrite`.
  - El `Error` de un `.transform()` del documento entero decía que no corre en los updates y
    mandaba a `.overwrite()`, que tampoco corre en ellos: un `$set` del título no recalcula un slug
    calculado con `.overwrite()`, y el documento que insertaría un upsert sí lo calcula. Ahora el
    mensaje dice dónde corre `.overwrite()`.
  - `$inc: { views: -5 }` sobre `views: 1`, un `z.number().int().min(0)`, guarda −4, también con
    `jsonSchema: true`, porque el `$jsonSchema` no lleva `minimum`. Queda así por diseño: los
    update validators de Mongoose ignoran `$inc`, como dice su guía de validación, y el manual de
    MongoDB pone la guarda en el filtro del update, en «Model Data for Atomic Operations».
