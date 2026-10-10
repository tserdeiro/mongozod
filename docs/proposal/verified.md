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
    entre sí.

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

- **Nombre, subpaths y repo** (registro y documentación de npm, y repos de referencia):
  - `mongozod` lo publicó otro autor en 2023 y lo despublicó entero en 2025. Sus versiones, de la
    0.0.1 a la 0.1.1 y de la 1.0.0 a la 1.0.3, no se pueden volver a usar. La política de npm no
    dice si otra cuenta puede tomar un nombre despublicado, así que se confirma al publicar.
  - Un paquete sin scope siempre es público. `mongo-zod` y `mongodb-zod` no existen; `zod-mongo` y
    `mongoose-zod`, sí.
  - better-auth publica la mayoría de sus plugins como subpaths de `better-auth`, como
    `better-auth/plugins/organization`, y algunos como paquetes aparte, como `@better-auth/passkey`,
    `@better-auth/sso` y `@better-auth/stripe`. Varios de estos traen dependencias propias.
