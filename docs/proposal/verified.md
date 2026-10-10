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

- **Tests de los constructores de inputs** (16 en total, contra MongoDB 8.2 cuando hace falta):
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
    con refinements asíncronos.
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
    interno. `0.5` da `invalid_type` con `expected: 'int'` en `z.number().int()`, `z.int()`,
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
    un schema sin el campo, sin default, con otro tipo o sin el campo en un tipo de una unión no
    compila y lanza al definir el modelo.
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

- **Herramientas del repo** (pnpm 12.11.2, Node 22.23.2, Bun 1.4.3):
  - Vitest 5, tsdown 0.23 y Changesets 3 piden Node 22.12 o superior, y Node 20 llegó al final de su
    vida el 2026-04-30. El driver 7 todavía acepta Node 20.19.
  - Vitest corre con `bun --bun` dentro de Bun (`typeof Bun` es `object`) contra el replica set de
    mongodb-memory-server con MongoDB 8.2.6, y una transacción con `withTransaction` funciona. Bun
    1.3.13 fallaba al importar `bson` 7.3 (oven-sh/bun#32501, cerrado); 1.4.3 ya no.
  - tsdown emite los `.d.ts` con TypeScript 7.0.2 a través de tsgo, y attw y publint no encuentran
    problemas en el tarball.
  - El lint con tipos marca una promesa sin `await` (`no-floating-promises`) y un `as`.
