# Inputs de los endpoints

## Enfoque

Este enfoque reemplaza al `parser`. Cada endpoint declara qué acepta cada campo, y el cliente manda
directamente la sintaxis de Mongo.

- **Validación**: el schema rechaza todo lo demás, como un `$where`, un operador o un campo no
  declarado. Cada valor se valida con el schema de su campo, sin su default, así que una fecha que
  llega como ISO se convierte en `Date`.
- **Constructores**: uno por cada parte de una consulta:
  - **`mz.filter`**: los operadores que declara cada campo.
  - **`mz.update`**: los campos de cada operador, `$set`, `$unset` e `$inc`. `$unset` solo admite
    campos opcionales y `$inc`, solo numéricos. No completa defaults: un update parcial no pisa
    `content` con `''`.
  - **`mz.sort`**: los campos declarados, con `1` o `-1`, en el orden en que los manda el cliente.
  - **`mz.projection`**: los campos declarados, sin mezclar inclusión y exclusión.
  - **`mz.after`**: la página después de un documento, la paginación por clave.
  - **`mz.populate`**: las referencias que el cliente puede expandir y los campos que puede ver.
- **Errores de tipos al declarar**: un `$regex` sobre una fecha, un `$unset` de un campo
  obligatorio, un `$inc` sobre un string o un campo que no existe no compilan.
- **Con la API de Zod**: cada constructor devuelve un schema de Zod sin default. El proyecto decide
  qué pasa cuando el cliente no manda algo, con los métodos de Zod: `.default({})` en una lista,
  `.required({ _id: true })` en un filtro por id, para que un `{}` no coincida con cualquier
  documento, o `.refine()` para pedir al menos un campo.

## Cómo se usa

El ejemplo usa `brands`, que hoy expande `organization`. El código compila con TypeScript 5.5 y 7:

```ts
// model.ts: organizations belong to Better Auth, so the reference names the collection and schema.

export const BrandsModel = mongozod({
  schema: brandSchema,
  collection: 'brands',
  db: () => db,
  plugins: [softDelete()],
  references: { organization: { collection: 'organizations', schema: organizationSchema } }
})
```

```ts
// schemas/validations.ts: client-safe, no model imported.

import * as mz from 'mongozod/mzod'
import { z } from 'zod'

/** The project's own search, here MongoDB's text index. */
function textSearch(term?: string) {
  if (!term) return {}

  return { $text: { $search: term } }
}

const organizationPopulate = mz
  .populate({ organization: organizationSchema.pick({ _id: true, name: true }) })
  .optional()

export const listBrandsSchema = z.object({
  after: mz.after(brandSchema, { createdAt: -1, _id: -1 }).default({}),
  filter: mz
    .filter(brandSchema, {
      _id: ['$eq', '$in'],
      host: ['$eq'],
      name: ['$eq', '$exists']
    })
    .default({}),
  limit: z.number().int().min(1).max(100).default(20),
  populate: organizationPopulate,
  term: z.string().optional().transform(textSearch)
})

export const findOneBrandSchema = z.object({
  filter: mz.filter(brandSchema, { _id: ['$eq'] }).required({ _id: true }),
  populate: organizationPopulate
})
```

```ts
// router.ts: every input is already a filter, so there is nothing to fall back on.

export async function list(input: z.output<typeof listBrandsSchema>) {
  const filter = { $and: [input.filter, input.after, input.term, scope] }
  const list = await BrandsModel.find(filter, {
    limit: input.limit,
    populate: input.populate,
    sort: { createdAt: -1, _id: -1 }
  })

  return { list }
}
```

El cliente manda, por ejemplo,
`{ filter: { name: { $exists: true } }, populate: { organization: { name: 1 } } }`, y el router
recibe `populate: { organization: { projection: { name: 1 } } }`. Como `after`,
manda `{ createdAt, _id }` del último elemento de la página.

## Decisiones de los inputs

1. **`mz`.** `mongozod/mzod` es el Zod de MongoDB: todo lo que Zod no trae para MongoDB, en un
   namespace, que se importa como el `import * as z` de Zod: `import * as mz from 'mongozod/mzod'`.
   - **Dos grupos**: los constructores de inputs, `mz.filter`, `mz.update`, `mz.sort`,
     `mz.projection`, `mz.after` y `mz.populate`, que reciben un schema; y los tipos de campo,
     `mz.objectId()`, `mz.decimal128()`, `mz.binary()`, `mz.uuid()`, `mz.date()`, `mz.set()` y los de GeoJSON, que van en el
     schema del documento. Los nombres los separan: los primeros son los de las opciones del driver
     (`find(filter)`, `updateOne(filter, update)`, `sort`, `projection`), y los segundos, tipos BSON.
     Están planos, como `z.string()` y `z.object()` en Zod: un sub-namespace como `mz.query` no
     cuesta bundle, pero alarga lo que más se usa y `query` no le queda a `update`.
   - **Un lugar**: primero los tipos de campo vivían en `mongozod/codecs/*` y `mongozod/geojson`,
     un corte por implementación, «convierte o no convierte», que un usuario no tiene por qué
     conocer.
   - **`after`**: primero se llamó `mz.cursor`, pero en el driver un cursor es el iterador de
     resultados, y el nombre venía de la key que espera el `useInfiniteQuery` de tRPC, no de
     MongoDB. `after` sigue al `searchAfter` de Atlas Search y a las consultas por rango del manual:
     la página después de un documento. La key del input la elige cada proyecto, también `cursor`.
   - **Junto a `z`**: no reexporta Zod, así que cada archivo conserva su `z` y suma un import, sin
     chocar. Cada constructor devuelve un schema de Zod que se anida en `z.object` como cualquier
     otro.
   - **Tree shaking**: primero exportaba un objeto `mz`, que el editor agrega solo al escribir `mz` y
     que no deja nombres sueltos como `filter`, `update` y `sort`, que chocan con variables comunes.
     Pero un bundler incluye el objeto entero: usar solo `mz.sort` sumaba 14 KB al cliente, y con
     exports con nombre suma 3,4 KB. Se eligió el tamaño, como Zod: el import se escribe una vez
     por archivo, como el de `z`, y los nombres sueltos solo aparecen con `import { filter }`. No se
     exporta además `mz` con nombre, como el `z` de Zod (`import { z } from 'zod'`): con rolldown,
     `import { mz }` incluye los seis constructores, 14,5 KB, y solo `import * as mz` deja afuera los
     que no se usan.
   - **Subpath**: `mongozod/mzod`, que explica el alias: `mz` sale de `mzod` como `z` sale de
     `zod`, y se usa igual, `mz.filter` junto a `z.object`. Es un subpath aparte porque exponer la
     sintaxis de MongoDB a clientes es opcional, una idea inspirada en GraphQL. Se descartaron
     `/mz`, que no se entendía, `/zod`, que hacía esperar un `z` reexportado, `/schemas` y
     `/validations`, que no dicen qué valida, y `/query-syntax`, el nombre de Feathers, que no
     convenció. No importa el driver, así los schemas de validación siguen sirviendo en web y en
     native. Sus tipos tampoco: toman `Document`, `ObjectId`, `Binary` y los tipos BSON de `bson`,
     que el driver reexporta, así un proyecto web no carga las declaraciones del driver.
2. **Sin fallbacks en el router, con la API de Zod.** Los constructores no tienen props propias
   para lo que pasa cuando el cliente no manda algo: lo decide el proyecto con Zod. Una lista usa
   `.default({})` en `mz.filter` y `mz.after`, así el router solo junta filtros con `$and`, sin
   `?? {}` ni `|| {}`, y el proyecto convierte el `term` en filtro dentro del schema. Un filtro por
   id usa `.required({ _id: true })`, y un findOne que pide al menos uno de varios campos, como los
   de adsgpt y wortise, usa `.refine()`. `sort`, `projection` y `populate` toman `.optional()` o un
   default, como `.default({ createdAt: -1 })`. Reemplaza a la opción `{ required: ['_id'] }` del
   prototipo.
   - **`mz.filter` es un `z.strictObject`**: por eso andan `.required()`, `.refine()`,
     `.default()` y `.extend()`. Como descarta las keys en `undefined` con `.overwrite()`, Zod no
     deja recortarlo: `.pick()`, `.omit()` y `.partial()` lanzan. Otro filtro se declara con otro
     `mz.filter`.
   - **Sin defaults del schema**: el valor de cada campo se valida sin su `.default()`. Hoy en
     app-maker, `pick({ _id: true }).required()` convierte un `{}` en un uuid nuevo, porque `_id`
     tiene default.
3. **`references` en el núcleo y `mz.populate`.** Con el contrato de plugins, un plugin no puede
   cambiar el tipo que devuelve `find`: haría falta un registro de tipos por declaration merging,
   bastante más complejo. Por eso `references` es una opción de `mongozod()`, como `indexes`. El
   nombre sigue al manual de MongoDB, que llama references a los `_id` guardados en otro documento.
   - **Destinos**: otro modelo, con un thunk como `() => BrandsModel`, para que se apliquen sus
     plugins. O una colección con su schema, para las que no tienen modelo, como `organizations`,
     que maneja Better Auth.
   - **`populate`**: toma `true` para el documento entero, o las opciones de la consulta con los
     nombres del driver, `{ organization: { projection: { name: 1 } } }`. Ver
     [Referencias](./model.md#referencias).
   - **Para clientes**: `mz.populate` recibe la lista blanca como un schema recortado con `pick`,
     como hoy. El cliente manda `true` para toda la lista blanca, nunca el documento entero, como
     el `populate` del modelo, o una proyección con `1` o `true` para algunos de sus campos. Un
     `{}`, una exclusión, un campo de afuera o una referencia no declarada fallan: los dos primeros
     con `takes true, or an object with 1 or true for some of its fields`, en vez del
     `Invalid input` de una unión, y el campo de afuera con el `Unrecognized key` de Zod. El router recibe
     el `populate` del modelo, con una `projection` de `1`. El cliente no manda `filter` ni `sort`:
     son decisiones del endpoint.
   - **Tipos**: un `populate` escrito en el código da el tipo exacto. El que manda un cliente deja
     el campo como unión con el id, igual que hoy `WithPopulate`, pero calculada sola: desaparecen
     `WithPopulate` y los tipos `BrandRecord`. Como el modelo no sabe si una proyección que llega
     en runtime incluye o excluye, deja opcional cada campo del documento expandido.
4. **Operadores de `mz.filter`.** Los de comparación, `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`,
   `$lt`, `$lte`, `$exists` y `$regex`, con `$options`, que es el set de la audiencia de wortise y
   cubre todos los usos de los tres proyectos. Y los de arrays: `$all`, `$size` y `$elemMatch`.
   - **Dónde aplican**: cada operador compila solo donde aplica: los rangos en números, strings,
     fechas e ids; `$regex` en strings; los de arrays en arrays. El editor sugiere los paths y, en
     cada uno, solo sus operadores.
   - **Igualdad**: un campo que declara `$eq` también acepta el valor solo, como en Mongo. En un
     array, la igualdad toma un elemento o el array entero, y los rangos comparan elementos.
   - **Valores sin claves `$`**: ningún valor, solo o dentro de un operador, puede ser un objeto
     con una clave que empieza con `$`, que falla con un `ZodError`. MongoDB lee ese objeto como
     operadores en una igualdad y en `$all`, y lo rechaza en `$in` (verificado con MongoDB 8.2.6),
     así que un campo que acepta cualquier objeto, como `z.record()`, `z.unknown()` o un
     `z.looseObject()`, dejaba pasar `{ $ne: null }` como valor. Ningún documento puede guardar
     esas claves, así que como valor nunca encontrarían nada. Se rechaza en vez de envolverlo en
     `$eq`, como hace el `sanitizeFilter` de Mongoose, porque esa igualdad pasaría sin encontrar
     nada y sin avisar. Lo mismo vale para los valores de `mz.after`.
   - **Objeto de operadores**: tiene al menos uno, porque `{}` es en Mongo una igualdad con un
     objeto vacío.
   - **`$options`**: solo va con `$regex`. Sin él, MongoDB rechaza el filtro con el código 2
     (`$options needs a $regex`), así que `mz.filter` lo rechaza antes, con un `ZodError`.
5. **`$elemMatch` toma lo declarado para el elemento.** En un array de objetos,
   `items: ['$elemMatch']` junto a `'items.status': ['$eq']` acepta, adentro, `status` con esos
   operadores, relativo al elemento como en MongoDB; `items.status` también vale en el primer nivel.
   En un array de valores, `scores: ['$gte', '$lt', '$elemMatch']` acepta esos operadores sobre el
   elemento. Sin nada declarado para el elemento, no compila.
6. **`$and`, `$or` y `$nor` se componen con Zod.** `mz.filter` acepta solo los campos declarados.
   Un endpoint que los necesita los suma con `.extend()`, y la misma lista blanca vale en cada
   nivel:

   ```ts
   const audience = mz.filter(accountSchema, { country: ['$eq', '$in'], role: ['$eq'] }).extend({
     get $and() {
       return z.array(audience).optional()
     },
     get $or() {
       return z.array(audience).optional()
     }
   })
   ```

   - **Lista blanca**: aceptarlos siempre les daría a todos los endpoints algo que nadie declaró.
   - **Costo**: un `$or` usa índices solo si todas sus cláusulas tienen uno; si no, recorre la
     colección. Un cliente podría convertir un filtro por `_id` en un recorrido completo, y anidar
     sin límite.
   - **Uso**: solo la audiencia de notificaciones de wortise los manda desde un cliente, con
     react-querybuilder. Hoy su `MongoQuerySchema` acepta cualquier campo.

7. **`undefined` se descarta.** Con JSON esas keys no viajan, y con superjson sí: descartarlas hace
   que la misma request signifique lo mismo con los dos, como hacen hoy los parsers de adsgpt y
   wortise. El driver las mandaría como `null`. Un objeto de operadores que queda vacío, como
   `{ $lte: undefined }`, se rechaza, y un campo marcado con `.required()` sigue rechazando
   `undefined`.
8. **`mz.update`: `$set`, `$unset` e `$inc`**, con las reglas del modelo: `$unset` solo en campos
   opcionales o en keys que un record o un catchall pueden no tener, y `$inc` solo en números,
   entero si el campo es entero. Esas keys las toma el runtime, como los updates del modelo; los
   tipos todavía no, porque el editor no las sugiere: queda para la fase 7 del
   [roadmap](./roadmap.md). Antes el runtime lanzaba que la key era requerida. Hoy los clientes
   mandan campos enteros, y wortise manda `null` para borrar 8 campos; `$inc` es el contador
   atómico, que con `$set` pisaría escrituras concurrentes.
   - **Paths fuera de arrays**: ni índices ni operadores posicionales, que arma el router.
   - **Vacío**: un update sin operadores falla, como en el driver. `{ $set: {} }` pasa, porque
     MongoDB lo acepta y no hace nada.
   - **Dos validaciones**: `mz.update` valida y parsea los valores, y el modelo los vuelve a validar
     al escribir. Con la forma documentada de las fechas, un `Date` vuelve a pasar igual.
9. **`mz.sort` y `mz.projection` se declaran con una máscara, como `.pick()`:**
   `mz.sort(noteSchema, { createdAt: true, title: true })`. Con un array, el editor no sugiere los
   paths y un error pierde su mensaje, el mismo límite de TypeScript que tuvo `indexes`.
   - **Orden**: `mz.sort` conserva el orden en que el cliente manda las keys, que decide qué ordena
     primero. Un `z.object` devuelve sus keys en el orden del schema, así que usa
     `z.partialRecord`. Las tablas de los tres proyectos mandan una sola columna, a veces con punto.
   - **Valores**: `mz.sort` toma `1` o `-1`. `mz.projection` toma `1` o `true` para incluir y `0` o
     `false` para excluir, como MongoDB, sin mezclar salvo `_id`.
10. **`mz.after` pide `_id` al final y campos obligatorios.** MongoDB ordena un valor que falta o
    es `null` antes que cualquier otro, y un `$lt` sobre una fecha no lo alcanza, así que esos
    documentos se perderían. Sin un campo único al final, las páginas repiten o saltean empates.
    - **Chequeos**: un campo opcional o nullable, dentro de un array o que guarda un array no
      compila y lanza un `Error` al declararlo. MongoDB ordena un array por uno de sus elementos, y
      un rango lo toma si cualquiera pasa, así que la paginación repetiría y saltearía documentos
      (verificado: 6 documentos en páginas de 2 daban 7 vistos y 4 únicos). Los tipos piden `_id`,
      pero no ven el orden de las keys de un objeto: que `_id` sea el último lo chequea el runtime.
      Un campo con un `.transform()` que devuelve un array, como un string que se parte por comas,
      lo rechazan los tipos, que ven su salida, y no el runtime: la salida de un transform no se ve
      sin parsear un valor, y rechazar todo transform dejaría afuera los que devuelven un valor de
      orden, como `.transform((s) => s.toLowerCase())`. Un codec sí se ve, porque su salida es un
      schema: uno que devuelve un array lanza al declararlo, y `mz.date()` pasa (verificado).
    - **Formato**: el cliente manda los valores de orden del último documento,
      `{ createdAt, _id }`, y el router recibe el `$or` de la página siguiente. La primera página no
      lo manda. Con tRPC, el input lo puede llamar `cursor`, la key que espera `useInfiniteQuery`.
    - **`skip` también es de MongoDB**: el manual explica las dos formas en `cursor.skip()`. `skip` y
      `limit` sirven para tablas con páginas numeradas, donde se salta a la página 7, y son
      opciones del driver que el modelo pasa tal cual; un cliente manda un número, que no necesita
      un constructor. Las consultas por rango usan el índice y no se corren cuando se inserta un
      documento mientras se pagina, pero no saltan páginas.
    - **Hoy**: ningún proyecto pagina por clave. El scroll infinito manda el número de página, y
      `skip` y `limit` siguen para las tablas con páginas numeradas.
11. **Declaraciones inválidas**: no compilan y lanzan un `Error` al declarar, con el nombre del
    constructor: un path que no existe, un operador desconocido, uno de arrays en un campo que no
    lo es, un `$elemMatch` sin nada que tomar, un `$unset` de un campo obligatorio, un `$inc` sobre
    algo que no es número, y un path que pasa por un array en `mz.update` o `mz.after`. Un `$regex`
    sobre algo que no es string y un rango sobre un booleano solo no compilan: en runtime, el valor
    se valida igual con el schema del campo.
12. **Schemas**: los constructores aceptan schemas de Zod y de Zod Mini, y uniones discriminadas
    en la raíz, que buscan cada campo en sus tipos. Construyen schemas de Zod clásico. El `_id` se
    filtra si el schema lo declara: sin el driver no hay `ObjectId`.
13. **`ObjectId`**: se declara con `mz.objectId()`, como
    `_id: mz.objectId().default(() => new ObjectId())`. Es la unión de un codec de su hex y un
    `ObjectId`, como `mz.date()` con las fechas: el servidor pasa un `ObjectId`, el cliente manda el hex
    de 24 caracteres (`z.hex().length(24)`, en mayúsculas o minúsculas), el modelo y los
    constructores de `mz` lo convierten con `ObjectId.createFromHexString`, y `z.encode` lo vuelve a
    hex. El codec va primero: con el `ObjectId` primero, `z.encode` lo devuelve sin cambios.
    Cualquier otro valor da un solo issue: `Invalid ObjectId: expected an ObjectId or its
    24-character hex string`. Uno que falta suma `, received undefined`, como dice Zod de un campo
    que falta, igual que `mz.date()`, `mz.decimal128()`, `mz.binary()` y `mz.uuid()`: el mensaje de
    Zod para una unión es solo `Invalid input`.
    - **Importa `bson`, nunca el driver**: `bson` no tiene dependencias y publica builds para browser
      y React Native, así que sirve en un schema compartido con el cliente. Es un peer obligatorio
      (`^6.10.0 || ^7.0.0`), del mismo major que el driver, porque su serializador rechaza los
      valores de otro major. npm 7+ y pnpm, con `autoInstallPeers`, que viene activo, lo instalan
      solos; Yarn moderno no. Fue un peer opcional mientras solo un subpath, `mongozod/codecs/bson`,
      lo importaba; en `mongozod/mzod`, Node lo carga aunque no se use `mz.objectId()`. Un bundler,
      en cambio, lo deja afuera si no se usa.
    - **Sin `instanceof`**: reconoce un `ObjectId` por su `_bsontype`, como el serializador de
      bson. `instanceof` falla entre dos copias de bson, y también con una sola: en Node, el driver
      carga el build CommonJS de bson, y una app que importa `bson` como módulo ES recibe otra clase.
      El símbolo `bsonType` serviría, pero bson 6 no lo tiene.
    - **Codec y no `.transform()`**: un transform no se puede encodear. El `ObjectId` de
      `mz.objectId()` declara `.meta({ bsonType: 'objectId' })`, la misma metadata que cualquier campo
      puede usar, así el `$jsonSchema` le da su tipo (ver
      [Sincronización](./model.md#sincronización)).
    - **Frente a las otras formas**: `z.instanceof(ObjectId)` rechaza el hex de un cliente, y un
      regex con `.transform()` rechaza el `ObjectId` del servidor y tipa el insert como `string`.
      Zod no trae un codec de `ObjectId` entre sus ejemplos.
14. **`Decimal128`**: se declara con `mz.decimal128()`, el tipo para dinero. Es la unión de un codec de su string y un `Decimal128`, como `objectId()`: el servidor
    pasa un `Decimal128`, el cliente manda el string, como `'10.50'`, y `z.encode` lo vuelve a
    string; sin eso, `JSON.stringify` da `{ $numberDecimal: '10.50' }`, el Extended JSON del
    `toJSON()` de bson, que también toma: así un documento que un endpoint devuelve con
    `res.json(doc)` vuelve sin `z.encode`. Es el único tipo de `mz` cuyo JSON no es un string: el
    `ObjectId` da su hex, el `UUID` su string, el `Binary` su base64 y la fecha su ISO, y bson 6.10 y
    7 dan lo mismo (verificado). Valida con
    `Decimal128.fromString`, la API de bson, que rechaza lo que no es un decimal y lo que
    redondearía, con más de 34 dígitos. `NaN` e `Infinity`, que bson toma, también `'inf'`, se
    rechazan en todas sus formas: un monto es un número, y sin eso un `$inc` de `'NaN'` lo guardaba.
    Un `NaN` ya guardado se lee, porque las lecturas no se parsean, y se corrige con un `$set`, pero
    no se reescribe tal como se leyó: un `replaceOne` con lo leído, o su `z.encode`, da un
    `ZodError`. El rechazo es del valor que se manda: el servidor todavía guarda un `Infinity`
    cuando un `$mul` se pasa del rango del decimal, como `1e6144` por `10` (verificado). Lo reconoce
    por su `_bsontype`, y su metadata le da `bsonType: 'decimal'` en el `$jsonSchema`.
    - **Comparar con un número**: un filtro del modelo sobre un decimal no toma un `number`, aunque
      MongoDB compara por valor entre tipos numéricos: un double no siempre es el decimal que se
      escribió, y con `{ balance: 9.99 }` o `{ $gte: 9.99 }` MongoDB 8.2 deja afuera el 9.99
      guardado (verificado). Se pasa `Decimal128.fromString('9.99')`, o el valor del cliente por
      `mz.filter`, que lo convierte.
    - **Números**: toma uno si es el decimal que se escribió: un `double` conserva exactos 15
      dígitos significativos, y un entero seguro, todos. `10.5` y `19.99 * 3`, `59.97`, pasan. Uno
      con más dígitos, como el `0.30000000000000004` de `0.1 + 0.2`, o el que `JSON.parse` ya
      redondeó, falla pidiendo el string: guardarlo cambiaría el monto sin avisar. Mongoose castea
      cualquier número.
    - **Un solo codec**: su entrada es la unión de un string, un número exacto y un `Decimal128`,
      así el error de un número dice que mande el string; con la unión de un codec y la instancia,
      como `objectId()`, el error de la unión de afuera lo tapaba.
    - **`$inc` y `$mul`**: MongoDB los aplica a un `Decimal128` (verificado), y el valor se parsea
      con el schema del campo sin sus checks, también en `mz.update`: un `'0.10'` o un `0.1` llega
      como un `Decimal128` exacto, y la suma también lo es. En un campo que también acepta `null`, el
      monto no lo acepta. Los checks quedan afuera porque validan
      el valor del campo y no lo que lo cambia, como con los números: un saldo con
      `.refine((d) => Number(d.toString()) >= 0)` acepta un `$inc` de `'-10'`.
15. **Binarios**: se declaran con `mz.binary()`. Toma el base64 de los
    bytes, que manda un cliente JSON, un `Uint8Array` o un `Buffer`, que pasa el servidor, o un
    `Binary`, y devuelve un `Binary`. `z.encode` lo vuelve a base64.
    - **Devuelve un `Binary`, no un `Uint8Array`**: el driver guarda un `Uint8Array` como un
      `Binary` genérico, subtipo 0, y lo lee como `Binary`. Con un `Uint8Array`, el tipo de las
      lecturas mentiría, y un documento leído no podría volver a escribirse. La opción
      `promoteBuffers: true` del driver los lee como `Buffer`, pero a todos los binarios, también a
      los UUID. Por eso necesita `bson`, como `mz.objectId()` y `mz.decimal128()`.
    - **Subtipos**: un `Binary` pasa tal cual, con su subtipo, y un UUID sigue siendo un UUID; los
      bytes y el base64 pasan a ser uno genérico, como los guarda el driver.
    - **TypeScript 5.5**: su tipo de retorno está escrito, porque TypeScript 7 emitiría
      `Uint8Array<ArrayBufferLike>`, que TypeScript 5.5 no acepta.
16. **Fechas**: se declaran con `mz.date()`. Es la unión del codec
    `isoDatetimeToDate` de la documentación de Zod y una `Date`: el servidor pasa una `Date`, el
    cliente manda un ISO con `Z` o con zona horaria (`z.iso.datetime({ offset: true })`), y
    `z.encode` lo vuelve a ISO en UTC. Un ISO sin `Z` ni zona horaria se rechaza, porque no dice qué
    instante es, y cualquier otro valor da un solo issue: `Invalid date: expected a Date or an ISO
    datetime string with Z or an offset`.
    - **Por qué un codec propio**: Zod no exporta sus codecs, sino que los propone para copiar y
      adaptar. Copiado, el orden de la unión es fácil de equivocar: con la `Date` primero, `z.encode`
      la devuelve sin cambios, y así estaba la forma que documentaba esta propuesta.
    - **Sin `bson`**: importa solo Zod, así que un cliente que usa `mz.date()` no carga `bson`.

17. **GeoJSON**: `mz.point()`, `mz.lineString()`, `mz.polygon()`, `mz.multiPoint()`,
    `mz.multiLineString()`, `mz.multiPolygon()` y `mz.geometryCollection()`, schemas de Zod del
    GeoJSON que MongoDB guarda y consulta. No convierten valores: validan la forma.
    - **Qué chequean**: lo que MongoDB rechaza con un índice `2dsphere`, que sin uno guarda tal cual:
      `[longitud, latitud]`, en ese orden y en sus rangos, con una altitud opcional; una línea con
      dos posiciones distintas; anillos cerrados, con cuatro posiciones al menos; y geometrías no
      vacías. Una `GeometryCollection` no puede estar vacía ni contener otra, como MongoDB y el RFC 7946. Que un anillo no se cruce consigo mismo, o que un hueco esté dentro del anillo
      exterior, lo chequea el índice.
    - **Altitud**: MongoDB acepta un tercer valor, y hasta un cuarto; el RFC 7946 permite la altitud
      y desaconseja más, así que toman tres como máximo.
    - **Sin `bson`**: importan solo Zod, así sirven en el cliente.

18. **UUID**: se declaran con `mz.uuid()`, que los guarda como un `Binary` de subtipo 4: 16 bytes,
    donde su string ocupa 36
    ([Automattic/mongoose#3208](https://github.com/Automattic/mongoose/issues/3208)). Toma el
    string de un UUID, que manda un cliente JSON, o un `UUID`, y devuelve un `UUID`. `z.encode`
    lo vuelve al string, y `JSON.stringify` también, por el `toJSON()` de bson.
    - **Devuelve un `UUID`**: el driver lee el subtipo 4 como un `UUID`, una subclase de `Binary`,
      con bson 6.10 y con bson 7 (verificado). Así el tipo de las lecturas es el que llega, y un
      documento leído vuelve a escribirse. Un `Binary` de subtipo 4 pasa a ser un `UUID`; uno de
      otro subtipo se rechaza.
    - **El string**: el de `z.uuid()`, con guiones, en mayúsculas o minúsculas. Sin guiones se
      rechaza, aunque bson lo acepta, porque no es la forma que manda un cliente.
    - **Filtros**: el modelo no castea, así que un filtro escrito a mano pide un `UUID`; el string
      que manda un cliente lo convierte `mz.filter`.

19. **Sets**: se declaran con `mz.set(item)`, el array de `$addToSet`: guarda cada valor una vez
    ([Automattic/mongoose#3347](https://github.com/Automattic/mongoose/issues/3347) y
    [#8082](https://github.com/Automattic/mongoose/issues/8082)). Un valor repetido lanza un
    `ZodError` con el índice del repetido; no se sacan en silencio.
    - **Devuelve un array**, no el `Set` de `z.set()`: las lecturas no se parsean y el driver
      devuelve arrays. Tampoco toma un `Set`: un codec de un `Set` al array no tipa cuando el
      elemento es un codec, como `mz.objectId()`, porque decodifica la salida de cada elemento y la
      vuelve a pasar por su entrada.
    - **La igualdad**: la del `uniqueItems` del `$jsonSchema` de MongoDB (verificado): los números
      por su valor (`1` y `1.0`), los valores BSON por el suyo (dos copias de un `ObjectId`), las
      fechas por su instante y los objetos por sus campos en cualquier orden. Los elementos se
      parsean antes, así que un hex y el `ObjectId` que decodifica son el mismo.
    - **Updates**: solo `$addToSet` agrega. `$push`, y escribir un elemento por su índice o un
      operador posicional (`tags.0`, `tags.$`, `tags.$[]`), no compilan y lanzan un `ZodError`. Un
      `$set` del array entero se parsea, y `$pull`, `$pullAll` y `$pop` sacan.
    - **El servidor**: `sync()` le pone `uniqueItems: true` en el `$jsonSchema`, así que, con
      `jsonSchema`, MongoDB rechaza también un repetido que llega por otro lado, como un `$push` del
      driver o un update con pipeline. Sin él, queda un caso que mongozod no ve: `$addToSet` compara
      los objetos con el orden de sus campos, y agrega uno igual en otro orden.
    - **Cómo lo reconoce el modelo**: por su chequeo, una sola instancia que conservan los clones
      de `.min()` y los wrappers como `.optional()`; los tipos, por una marca en el tipo del schema.

## Qué reemplaza

- `parser.query` pasa a ser `mz.filter`.
- `parser.update` pasa a ser `mz.update`: el cliente manda `$unset` en vez de `null`.
- `removeDefaults`, `arrayable` y `existsable` desaparecen: se reemplazan por lo que se declara en
  cada constructor. El cliente manda `{ $in: [...] }` y `{ $exists: true }`, la sintaxis de Mongo.
- El `sort` y la `projection` con `z.any()` de `paginationSchema` pasan a ser `mz.sort` y
  `mz.projection`, lo que cierra el hueco de wortise/adsgpt#231.
- La página con `skip` del scroll infinito pasa a ser `mz.after`.
- `populateSchema` y `WithPopulate` pasan a ser `mz.populate` y los tipos calculados.
- `parser.search` no se reemplaza: cada proyecto convierte su `term` en filtro, por ejemplo con
  `$text`, que necesita un índice de texto.
- El `MongoQuerySchema` de la audiencia de wortise pasa a ser un `mz.filter` con `$and` y `$or`
  compuestos con Zod.
