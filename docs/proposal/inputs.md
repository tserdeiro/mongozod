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
  - **`mz.cursor`**: la paginación por clave.
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

import * as mz from 'mongozod/mz'
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
  cursor: mz.cursor(brandSchema, { createdAt: -1, _id: -1 }).default({}),
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
  const filter = { $and: [input.filter, input.cursor, input.term, scope] }
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
recibe `populate: { organization: { projection: { name: 1 } } }`. Como `cursor`,
manda `{ createdAt, _id }` del último elemento de la página.

## Decisiones de los inputs

1. **`mz`.** `mongozod/mz` exporta cada constructor con su nombre, y se importa como namespace,
   como el `import * as z` de Zod: `import * as mz from 'mongozod/mz'`, y después `mz.filter`,
   `mz.update`, `mz.sort`, `mz.projection`, `mz.cursor` y `mz.populate`.
   - **Junto a `z`**: no reexporta Zod, así que cada archivo conserva su `z` y suma un import, sin
     chocar. Cada constructor devuelve un schema de Zod que se anida en `z.object` como cualquier
     otro.
   - **Tree shaking**: primero exportaba un objeto `mz`, que el editor agrega solo al escribir `mz` y
     que no deja nombres sueltos como `filter`, `update` y `sort`, que chocan con variables comunes.
     Pero un bundler incluye el objeto entero: usar solo `mz.sort` sumaba 14 KB al cliente, y con
     exports con nombre suma 3,4 KB. Se eligió el tamaño, como Zod: el import se escribe una vez
     por archivo, como el de `z`, y los nombres sueltos solo aparecen con `import { filter }`.
   - **Subpath**: `mongozod/mz`, igual que lo único que exporta. `/zod` hacía esperar un `z`, y
     `/inputs` no coincidía con `mz`. No importa el driver, así los schemas de validación siguen
     sirviendo en web y en native.
2. **Sin fallbacks en el router, con la API de Zod.** Los constructores no tienen props propias
   para lo que pasa cuando el cliente no manda algo: lo decide el proyecto con Zod. Una lista usa
   `.default({})` en `mz.filter` y `mz.cursor`, así el router solo junta filtros con `$and`, sin
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
     `{}`, una exclusión, un campo de afuera o una referencia no declarada fallan. El router recibe
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
   opcionales y `$inc` solo en números, entero si el campo es entero. Hoy los clientes mandan campos
   enteros, y wortise manda `null` para borrar 8 campos; `$inc` es el contador atómico, que con
   `$set` pisaría escrituras concurrentes.
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
10. **`mz.cursor` pide `_id` al final y campos obligatorios.** MongoDB ordena un valor que falta o
    es `null` antes que cualquier otro, y un `$lt` sobre una fecha no lo alcanza, así que esos
    documentos se perderían. Sin un campo único al final, las páginas repiten o saltean empates.
    - **Chequeos**: un campo opcional o nullable, o dentro de un array, no compila y lanza un
      `Error` al declararlo. Los tipos piden `_id`, pero no ven el orden de las keys de un objeto:
      que `_id` sea el último lo chequea el runtime.
    - **Formato**: el cliente manda los valores de orden del último documento,
      `{ createdAt, _id }`, y el router recibe el `$or` de la página siguiente. Con tRPC es el
      `cursor` del input: la primera página no lo manda.
    - **Hoy**: ningún proyecto pagina por clave. El scroll infinito manda el número de página, y
      `skip` y `limit` siguen para las tablas con páginas numeradas.
11. **Declaraciones inválidas**: no compilan y lanzan un `Error` al declarar, con el nombre del
    constructor: un path que no existe, un operador desconocido, uno de arrays en un campo que no
    lo es, un `$elemMatch` sin nada que tomar, un `$unset` de un campo obligatorio, un `$inc` sobre
    algo que no es número, y un path que pasa por un array en `mz.update` o `mz.cursor`. Un `$regex`
    sobre algo que no es string y un rango sobre un booleano solo no compilan: en runtime, el valor
    se valida igual con el schema del campo.
12. **Schemas**: los constructores aceptan schemas de Zod y de Zod Mini, y uniones discriminadas
    en la raíz, que buscan cada campo en sus tipos. Construyen schemas de Zod clásico. El `_id` se
    filtra si el schema lo declara: sin el driver no hay `ObjectId`.
13. **`ObjectId`**: se declara con `objectId()`, de `mongozod/codecs/bson`, como
    `_id: objectId().default(() => new ObjectId())`. Es la unión de un codec de su hex y un
    `ObjectId`, como `date()` con las fechas: el servidor pasa un `ObjectId`, el cliente manda el hex
    de 24 caracteres (`z.hex().length(24)`, en mayúsculas o minúsculas), el modelo y los
    constructores de `mz` lo convierten con `ObjectId.createFromHexString`, y `z.encode` lo vuelve a
    hex. El codec va primero: con el `ObjectId` primero, `z.encode` lo devuelve sin cambios.
    Cualquier otro valor da un solo issue: `Invalid ObjectId: expected an ObjectId or its
    24-character hex string`.
    - **Importa `bson`, nunca el driver**: `bson` no tiene dependencias y publica builds para browser
      y React Native, así que sirve en un schema compartido con el cliente. Es un peer opcional
      (`^6.10.0 || ^7.0.0`), del mismo major que el driver, porque su serializador rechaza los
      valores de otro major. `mongozod/codecs/bson` es el único build que importa `bson`.
    - **Sin `instanceof`**: reconoce un `ObjectId` por su `_bsontype`, como el serializador de
      bson. `instanceof` falla entre dos copias de bson, y también con una sola: en Node, el driver
      carga el build CommonJS de bson, y una app que importa `bson` como módulo ES recibe otra clase.
      El símbolo `bsonType` serviría, pero bson 6 no lo tiene.
    - **Codec y no `.transform()`**: un transform no se puede encodear. mongozod registra el
      `ObjectId` de `objectId()` en un registro de Zod (`core.registry`), así el `$jsonSchema` le da
      `bsonType: 'objectId'`.
    - **Frente a las otras formas**: `z.instanceof(ObjectId)` rechaza el hex de un cliente, y un
      regex con `.transform()` rechaza el `ObjectId` del servidor y tipa el insert como `string`.
      Zod no trae un codec de `ObjectId` entre sus ejemplos.
14. **Fechas**: se declaran con `date()`, de `mongozod/codecs/date`. Es la unión del codec
    `isoDatetimeToDate` de la documentación de Zod y una `Date`: el servidor pasa una `Date`, el
    cliente manda un ISO con `Z` o con zona horaria (`z.iso.datetime({ offset: true })`), y
    `z.encode` lo vuelve a ISO en UTC. Un ISO sin `Z` ni zona horaria se rechaza, porque no dice qué
    instante es, y cualquier otro valor da un solo issue: `Invalid date: expected a Date or an ISO
    datetime string with Z or an offset`.
    - **Por qué un codec propio**: Zod no exporta sus codecs, sino que los propone para copiar y
      adaptar. Copiado, el orden de la unión es fácil de equivocar: con la `Date` primero, `z.encode`
      la devuelve sin cambios, y así estaba la forma que documentaba esta propuesta.
    - **Sin `bson`**: importa solo Zod. Los codecs viven en `mongozod/codecs`, un subpath por codec,
      así `date()` no pide `bson`.

## Qué reemplaza

- `parser.query` pasa a ser `mz.filter`.
- `parser.update` pasa a ser `mz.update`: el cliente manda `$unset` en vez de `null`.
- `removeDefaults`, `arrayable` y `existsable` desaparecen: se reemplazan por lo que se declara en
  cada constructor. El cliente manda `{ $in: [...] }` y `{ $exists: true }`, la sintaxis de Mongo.
- El `sort` y la `projection` con `z.any()` de `paginationSchema` pasan a ser `mz.sort` y
  `mz.projection`, lo que cierra el hueco de wortise/adsgpt#231.
- La página con `skip` del scroll infinito pasa a ser `mz.cursor`.
- `populateSchema` y `WithPopulate` pasan a ser `mz.populate` y los tipos calculados.
- `parser.search` no se reemplaza: cada proyecto convierte su `term` en filtro, por ejemplo con
  `$text`, que necesita un índice de texto.
- El `MongoQuerySchema` de la audiencia de wortise pasa a ser un `mz.filter` con `$and` y `$or`
  compuestos con Zod.
