# Auditoría de las fases 1 a 4

Revisión de lo implementado hasta la fase 4 del [roadmap](../proposal/roadmap.md) (commits
`bab129f` a `57db46d`), en dos pasadas:

1. **Contra la propuesta y sus consumidores**: adsgpt, wortise-dashboard-monorepo y app-maker, con
   el `MongoModel` de adsgpt como punto de partida.
2. **Como librería**: para cualquier equipo que deje Mongoose y pase a MongoDB con Zod, más allá de
   esos tres proyectos.

No se modificó código. Esto se revisó:

- **Lectura**: todo el código fuente de `packages/mongozod/src`, la configuración del repo y la
  propuesta tal como quedó.
- **Chequeos**: `pnpm check-types`, `pnpm lint` y `pnpm test`. Pasan los 194 tests de 20
  archivos.
- **Pruebas aparte**: con Zod 4.6.5, el driver 7.6 y 7.7, MongoDB 8.2.6 y el build de `dist/`, con
  scripts que viven fuera del repo.
- **Fuentes**: la documentación oficial de Mongoose, del driver y de Zod, y el registro de npm.

## Resumen

- **La implementación sigue la propuesta.** No encontré código que contradiga lo que dice la
  propuesta.
- **El código de más sale del alcance acordado**: tipos estrictos, validación de updates por path,
  plugins, `mz`, referencias y virtuals, que `MongoModel` no tenía (ver
  [Por qué hay más código](#por-qué-hay-más-código-que-en-mongomodel)). Como librería, nada de eso
  sobra: lo que se puede recortar es interno (hallazgos 5 a 7).
- **Hay cuatro errores**:
  1. El CI rechaza los commits con `!`.
  2. Una tabla de la propuesta quedó vieja.
  3. `mz.filter` acepta un `$options` sin `$regex`.
  4. Una referencia con punto pasa el chequeo, y `populate` la ignora sin avisar.
- **A quien migra desde Mongoose le faltan cosas**, todas verificadas: ObjectId en los inputs,
  `populate` en arrays de subdocumentos, convivencia con Mongoose 8, el casting de los filtros, los
  updates con pipeline, y un README con una guía de migración (ver
  [Como librería](#como-librería-quien-deja-mongoose)).
- **El criterio de la v1 está escrito para los tres proyectos.** Como criterio de una librería deja
  afuera API estándar de MongoDB, así que conviene reformularlo. Es una decisión.

## Por qué hay más código que en MongoModel

Líneas de código fuente, sin tests:

| Área                                                                                                |  mongozod | Qué hacía MongoModel                                                                                                         |
| --------------------------------------------------------------------------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------------------------- |
| Modelo y operaciones (`mongozod.ts`, `model.ts`, cursores, `parse-document.ts`)                     |     1.450 | Wrappers con `Filter` y `UpdateFilter` del driver, y validación con `looseObject`.                                           |
| Tipos estrictos (`filter.ts`, `sort.ts`, `projection.ts`, `update.ts`, `schema-at.ts`, sugerencias) |     1.317 | No existían: usaba los tipos del driver, que aceptan `{ organization: ['a'] }` en un string.                                 |
| Updates en runtime y upserts (`parse-update.ts`, `update-path.ts`, `upsert.ts` y helpers)           |       763 | `validateUpdate`, sin paths con punto ni reglas por operador.                                                                |
| `timestamps`                                                                                        |       202 | `createdAt` al insertar y `updatedAt` en `$set`.                                                                             |
| Referencias, virtuals y lecturas (`references.ts`, `virtuals.ts`, `read-plan.ts`)                   |       649 | `populate` sin tipos y getters sin tipos.                                                                                    |
| `sync()`: índices y `$jsonSchema`                                                                   |       224 | Creaba los índices en cada `init`, sin `$jsonSchema`.                                                                        |
| Plugins y `softDelete`                                                                              |       905 | El borrado lógico estaba fijo en el modelo, y los hooks, vacíos.                                                             |
| `mz` (inputs)                                                                                       |       952 | `mongo-parser`, `mongo-zod` y los helpers de Zod de `libs`.                                                                  |
| **Total**                                                                                           | **6.462** | **1.771**: 1.086 del modelo (`mongo-model.ts`, `mongo-schema.ts`, `mongo-types.ts`, `db.ts`) y 685 del parser y los helpers. |

Los tests suman 4.434 líneas, más 300 del consumidor de los `.d.ts`.

Los tipos estrictos y la validación de updates por path son el 32% del código: los primeros no
existían, y la segunda era mucho más simple. Los plugins y `mz` son otro 29%.

## Qué está bien

- **Tipos y APIs oficiales**: el modelo usa los tipos del driver para opciones y resultados
  (`FindOptions`, `UpdateResult`, `ModifyResult`, `IndexDescription`…). También usa sus APIs:
  `MongoServerError` para el código 26, `BSON.EJSON` para comparar ids, y `hasNext` con
  `readBufferedDocuments` para leer por lotes. `mz` está hecho con la API de Zod: `strictObject`,
  `partialRecord`, `overwrite`, `refine` y `transform`.
- **`mz` sirve en el cliente**: el build de `dist/mz.mjs` solo importa `zod` y `zod/v4/core`, nunca
  el driver.
- **El `$jsonSchema` propio está justificado.** Probé `z.toJSONSchema` con `target: 'draft-04'`,
  `io: 'output'` y un handler de `unrepresentable` para las fechas. Su salida necesita siete
  adaptaciones para MongoDB:
  - sacar `$schema`, `default` y `format`;
  - convertir `type: 'integer'`;
  - reemplazar el `$ref` de `z.json()`;
  - abrir el `additionalProperties: false` que pone en cada `z.object`;
  - y además agrega `pattern`, `minLength` y rangos de `int`, que según la decisión quedan en la app.

  El recorrido de [json-schema.ts](../../packages/mongozod/src/model/json-schema.ts) escribe directamente
  lo que hace falta.

- **Sacar los `undefined` en la librería está justificado.** La opción `ignoreUndefined` del driver
  también los saca. Pero [parse-document.ts](../../packages/mongozod/src/model/parse-document.ts) además
  rechaza las keys con `.` o `$`, y devuelve un `document` sin esas keys.
- **Los tipos no son caros**:
  - Con TypeScript 7, el paquete y sus tests compilan en 0,39 s, con 1,4 millones de instanciaciones.
  - Con TypeScript 5.5, el consumidor de los `.d.ts` (`test/consumer`) compila en 0,95 s, con 304 mil.
- **Los tests van contra un MongoDB real**: un replica set 8.2.6, en Node 22.12, 24 y 26 y en Bun.
- **Supera a Mongoose donde importa**:
  - Valida cada update; Mongoose solo lo hace con `runValidators`, que
    [viene apagado](https://mongoosejs.com/docs/validation.html).
  - Tipa filtros, updates y proyecciones contra el schema.

## Hallazgos sobre la implementación

### Errores

1. **El CI rechaza los commits con `!`.** [AGENTS.md](../../AGENTS.md#L75) pide `feat(auth)!:` para
   los cambios incompatibles, pero el patrón de
   [conventions.yml](../../.github/workflows/conventions.yml#L24) es `^[a-z]+\([a-z0-9-]+\): .+$`.
   Lo probé: `feat(auth)!: drop x` falla. Hay que aceptar un `!` opcional antes de `:`, en el título
   y en los commits (líneas 24 y 36).
2. **La tabla de grupos de `operations.md` quedó vieja.** [operations.md](../proposal/operations.md#L8)
   pone `estimatedDocumentCount` y `aggregate` en `read`. El código
   ([plugin.ts](../../packages/mongozod/src/plugins/plugin.ts#L21)) y la
   [documentación de plugins](../proposal/plugins/README.md#hooks) los dejan sin grupo, que es lo
   correcto: no tienen filtro.
3. **`mz.filter` acepta un `$options` sin `$regex`.** Un campo con `['$regex']` suma `$options` a su
   schema ([mz/filter.ts](../../packages/mongozod/src/mz/filter.ts#L235)), y los dos son opcionales.
   Lo probé con el build:
   - `{ name: { $options: 'i' } }` pasa la validación.
   - MongoDB 8.2 lo rechaza con el código 2: `$options needs a $regex`.

   Un input de cliente válido termina así en un error del servidor. Basta con un `.refine()` que
   exija `$regex` cuando viene `$options`.

4. **Una referencia con punto pasa el chequeo, y `populate` la ignora.**
   - **Qué pasa**: el tipo de `references` solo acepta campos de primer nivel. Pero en runtime
     `checkReferences` busca la referencia como un path de filtro
     ([references.ts](../../packages/mongozod/src/references/references.ts#L161)), que atraviesa arrays.
     Entonces `references: { 'items.product': … }` pasa la definición.
   - **Qué devuelve**: `populate` lee `document['items.product']`
     ([references.ts](../../packages/mongozod/src/references/references.ts#L253)), que no existe, y deja el
     id sin avisar. Lo probé contra MongoDB 8.2: el pedido volvió con
     `items: [{ product: "6aca…", qty: 2 }]`.
   - **Qué dice la propuesta**: una referencia que no es un campo del schema lanza un `Error` al
     definir el modelo ([Referencias](../proposal/model.md#referencias)).
   - **Qué hacer**: chequear en runtime un campo de primer nivel, como los tipos, hasta que se
     decida si se soportan las referencias dentro de arrays (hueco 2 de
     [Como librería](#como-librería-quien-deja-mongoose)).

### Código duplicado o más complejo de lo necesario

5. **Dos recorridos de paths que hacen lo mismo.** `step()` de
   [schema-at.ts](../../packages/mongozod/src/schema/schema-at.ts#L149) y `next()` de
   [update-path.ts](../../packages/mongozod/src/updates/update-path.ts#L78) repiten las mismas ramas:
   - `any` y `unknown`;
   - uniones;
   - objetos con catchall;
   - records, que validan la key con su schema;
   - arrays con índice, `$`, `$[]` y `$[id]`.

   Además, `resolveUpdatePath` recorre cada path dos veces: primero con `schemaAt` (línea 187) y
   después con `walk`. Un solo recorrido que lleve el scope cuando hace falta elimina uno de los dos.

6. **Helpers repetidos entre archivos**:
   - **Los mismos tipos**:
     - `Unwrap` está igual en [projection.ts](../../packages/mongozod/src/types/projection.ts#L19) y
       [update.ts](../../packages/mongozod/src/types/update.ts#L19).
     - `Simplify` está en `projection.ts`, `references.ts` y `virtuals.ts`.
     - `FieldsOf` está en `references.ts` y `virtuals.ts`.
     - `UnionToIntersection` está en `projection.ts` y `plugin.ts`, y `IntersectAll`, en `update.ts`.
   - **Las mismas regex**: `IDENTIFIER` e `INDEX` están en
     [schema-at.ts](../../packages/mongozod/src/schema/schema-at.ts#L145) y
     [update-path.ts](../../packages/mongozod/src/updates/update-path.ts#L34).
   - **Interfaces casi iguales**: `AnyPlugin`
     ([plugin.ts](../../packages/mongozod/src/plugins/plugin.ts#L271)) y `RuntimePlugin`
     ([plugin-pipeline.ts](../../packages/mongozod/src/plugins/pipeline.ts#L20)).
   - **Una lista que ya existe**: `GROUP_NAMES`
     ([plugin-pipeline.ts](../../packages/mongozod/src/plugins/pipeline.ts#L39)) repite las keys de
     `GROUPS`.

   Como ya se usan en varios archivos, conviene que cada uno viva en un solo lugar.

7. **El `.default()` obligatorio de `timestamps` no se usa en runtime.**
   - **Qué pide hoy**: la [decisión](../proposal/README.md#decisiones-acordadas) pide declarar
     `createdAt` y `updatedAt` con un `.default()` o como opcionales. El tipo `InputProblem`
     ([timestamps.ts](../../packages/mongozod/src/model/timestamps.ts#L57)) lo exige.
   - **Por qué no se usa**: el núcleo completa las fechas antes de validar, con `stampDocument`
     ([mongozod.ts](../../packages/mongozod/src/mongozod.ts#L564), y también en `insertMany`, los
     reemplazos y `bulkWrite`). Con `timestamps` activo, el default del schema no corre en las
     escrituras del modelo; solo corre en una operación con `timestamps: false`. En la práctica
     sirve para que el tipo del insert no pida esos campos.
   - **Alternativa**: que el núcleo los haga opcionales en el tipo del insert cuando `timestamps`
     está activo. Así el schema puede declarar `createdAt: z.date()`, como es lo guardado, y
     `InputProblem` desaparece. Una operación con `timestamps: false` tendría que pasar las fechas,
     que es lo que significa escribirlas a mano.
   - **Como librería**: la [opción de Mongoose](https://mongoosejs.com/docs/guide.html) agrega los
     campos sola, así que a quien migra el `.default()` le resulta un paso de más.
   - **Hay que decidirlo**: la decisión actual está registrada.

### APIs propias frente a las oficiales

8. **`isInteger` prueba con `0.5`** ([schema-kinds.ts](../../packages/mongozod/src/schema/schema-kinds.ts#L30)).
   - **La premisa no es exacta**: la propuesta dice que «Zod no expone si un campo es entero»
     ([types.md](../proposal/types.md#updates-en-runtime)). Zod clásico sí lo expone, con
     `ZodNumber.format` (`'safeint'`, `'int32'`…). Su `isInt` está deprecado justamente a favor de
     `format`.
   - **Por qué igual se justifica**: Zod Mini no tiene esa propiedad, y el `aggregateChecks` que la
     calcula no se exporta desde `zod/v4/core`. La prueba sirve para los dos sabores de Zod.
   - **Qué corregir**: la frase de la propuesta, que debería decir «Zod Mini no expone…». Opcional:
     usar `format` cuando el schema lo tiene.
9. **El callback `indexes: (index) => [index(key, options)]`** es una API propia.
   - Devuelve el `IndexDescription` del driver.
   - Su ganancia es que el editor sugiere los paths
     ([Sincronización](../proposal/model.md#sincronización)), y se eligió en la fase 2.6 por eso.
   - **Como librería, conviene**: tiene la misma forma que el `schema.index(fields, options)` de
     Mongoose, que quien migra ya conoce.
10. **`SortDirection` se vuelve a declarar** ([sort.ts](../../packages/mongozod/src/types/sort.ts#L5)).
    - El driver ya exporta `SortDirection`, que acepta cualquier `$meta`; la nuestra lo restringe a
      `textScore`.
    - Se puede derivar del tipo del driver, cambiando solo su `$meta`, así sigue sus cambios.

### Configuración del repo

11. **`bun-version: latest`** ([ci.yml](../../.github/workflows/ci.yml#L67)): cada corrida puede
    usar otro Bun, así que un test puede empezar a fallar sin que cambie el repo. Fijarlo, como los
    paquetes, hace que el CI sea reproducible.
12. **Turborepo, sus nodos `transit` y el paquete `packages/config`** (21 líneas de JSON) son más
    estructura de la que hace falta con un solo paquete publicable. Se justifican cuando lleguen
    `examples/` y el sitio. Hasta entonces, pnpm alcanza. Prioridad baja.

## Como librería: quien deja Mongoose

mongozod no es solo para los tres proyectos. Es para cualquier equipo que quiera dejar Mongoose y
quedarse con el driver y Zod. Esta pasada compara con lo que documenta Mongoose y con lo que ese
equipo va a buscar.

### Lo que ya cubre

| Mongoose                                  | mongozod                                                             |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `new Schema()` y `model()`                | Un schema de Zod y `mongozod()`.                                     |
| `required`, `enum`, `min`, `max`, `match` | Los métodos de Zod.                                                  |
| `trim`, `lowercase`                       | `z.string().trim()`, `.toLowerCase()`.                               |
| `strict` y `strict: 'throw'`              | `z.object`, que descarta, y `z.strictObject`, que rechaza.           |
| `timestamps`                              | La opción `timestamps`, con los campos declarados en el schema.      |
| Virtuals con getter                       | `virtuals`, con `pick` y `transform`.                                |
| `populate`                                | `references` y `populate`, con los límites del hueco 2.              |
| Discriminators                            | Una `z.discriminatedUnion` en la raíz.                               |
| Middleware y plugins                      | Plugins con `before`, `after` y `middleware`.                        |
| `schema.index()` y `syncIndexes()`        | `index()` y `sync()`, que nunca borra un índice.                     |
| `lean()`                                  | Siempre: las lecturas devuelven objetos planos.                      |
| `runValidators` en los updates            | Siempre: cada update se valida.                                      |
| `Model.create()`                          | `insertOne` e `insertMany`, que devuelven el documento guardado.     |
| `findById()` y `findByIdAnd…()`           | Las operaciones del driver con `{ _id }`: mongozod espeja al driver. |

### Huecos verificados

1. **ObjectId en los inputs.** Quien viene de Mongoose casi siempre tiene ids `ObjectId`.
   - **Sin declarar el `_id`**, el driver lo genera, como en Mongoose. Pero
     `mz.filter(schema, { _id: ['$eq'] })` lanza `"_id" is not a path of the document`, así que un
     endpoint no puede filtrar por id. La propuesta lo prevé
     ([decisión 12](../proposal/inputs.md#decisiones-de-los-inputs)): sin el driver no hay
     `ObjectId`.
   - **Declarándolo como `z.instanceof(ObjectId)`**, un cliente JSON manda el id como string
     hexadecimal, y `mz.filter` lo rechaza con un `ZodError`. Probé los dos casos con el build.
   - **Mongoose castea ese string** a `ObjectId`
     ([Query Casting](https://mongoosejs.com/docs/tutorials/query_casting.html)). Con mongozod hace
     falta un codec de string hexadecimal a `ObjectId`, y hoy no trae ni documenta uno.
   - **Por qué un codec es posible en el cliente**: `mz` no puede importar el driver. Pero `bson`, el
     paquete de los tipos BSON que usa el driver, no tiene dependencias y publica builds para
     browser y React Native (7.3.3 en npm).
   - **Decidir**: un codec oficial, en un subpath que importe `bson`, o una receta en la
     documentación. Lo mismo vale para las referencias que guardan un `ObjectId`.
2. **El alcance de `populate`.**
   - **Qué documenta Mongoose** ([Populate](https://mongoosejs.com/docs/populate.html)):
     - referencias dentro de arrays de subdocumentos y de maps;
     - las opciones `select`, `match`, `options` (`sort`, `skip`, `limit`) y `perDocumentLimit`;
     - `populate` en varios niveles;
     - virtual populate por `localField` y `foreignField`;
     - referencias dinámicas con `refPath`.
   - **Qué hace mongozod**: solo campos de primer nivel que guardan un `_id` o un array de ids, con
     una proyección o `true`. Ni paths con punto, ni `populate` anidado, ni otro campo que el `_id`
     ([Referencias](../proposal/model.md#referencias)), porque nadie lo usa en los tres proyectos.
   - **Lo que más se va a extrañar**: la referencia dentro de un array de subdocumentos, como el
     `items.product` de un pedido. Es de lo más común.
   - **Decidir** qué entra en la v1. Como mínimo, corregir el error 4, para que no falle sin avisar.
3. **Convivencia con Mongoose mientras se migra.** Una migración de a poco usa los dos sobre la
   misma conexión.
   - **Mongoose 9** (la última versión, 9.11.1) depende de `mongodb ~7.7`, el mismo major que el
     peer `^7.0.0` de mongozod.
   - **Mongoose 8** sigue publicando versiones (8.24.5, del 4 de octubre de 2026) y depende de
     `mongodb ~6.20.0`. El `Db` de su conexión queda fuera del rango que soporta mongozod.
   - **Decidir**:
     - aceptar también el driver 6 en el peer, después de verificar qué usa mongozod del 7;
     - o documentar que primero se pasa a Mongoose 9, o se abre un `MongoClient` aparte.
4. **El casting de los filtros.**
   - **Mongoose** castea cada valor del filtro según el schema, de string a `ObjectId` o de string
     a número. Si no puede, lanza un `CastError`
     ([Query Casting](https://mongoosejs.com/docs/tutorials/query_casting.html)).
   - **mongozod** tipa los filtros, pero no los toca en runtime ([Filtros](../proposal/types.md#filtros)).
     Con TypeScript, un valor del tipo equivocado no compila. Con JavaScript, o con un filtro armado
     en runtime, la consulta no coincide con nada y no avisa.
   - **Decidir**: documentarlo como diferencia, u ofrecer en el modelo, como opción, el parseo que
     `mz.filter` ya hace.
5. **Updates con pipeline de agregación.**
   - **MongoDB** los acepta desde la 4.2
     ([manual](https://www.mongodb.com/docs/manual/tutorial/update-documents-with-aggregation-pipeline/)).
   - **mongozod** no los compila y lanza un `ZodError` ([Updates](../proposal/types.md#updates)):
     no se pueden validar por path, y ninguno de los tres proyectos los usa.
   - **La salida** es `.collection`, que se saltea los plugins, `timestamps` y `softDelete`.
   - **Decidir**: dejarlos pasar con plugins y `timestamps` pero sin validar los valores, o
     documentar la salida.
6. **No hay README ni guía de migración.**
   - No hay `README.md` en la raíz ni en `packages/mongozod`, aunque
     [structure.md](../proposal/structure.md) lo prevé. Al publicar la 0.x (fase 6), la página del
     paquete en npm quedaría vacía.
   - La documentación para usuarios está en la fase 7. Para este público, además, hace falta una
     guía «Desde Mongoose», con la tabla de equivalencias, los huecos y las recetas de abajo.

### Funciones de Mongoose sin equivalente

No son errores. Son lo que quien migra va a buscar, y la guía tiene que decir cómo se hace con
mongozod, con una receta o con un plugin oficial a futuro. Lo que dice Mongoose sale de su
[guía](https://mongoosejs.com/docs/guide.html) y de sus
[SchemaTypes](https://mongoosejs.com/docs/schematypes.html).

| Mongoose                                                   | En mongozod                                                                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El virtual `id`, el `_id` como string                      | Un virtual. Probado: `id: z.object({ _id: z.instanceof(ObjectId) }).transform((u) => u._id.toHexString())`.                                                                                                          |
| Un `_id` en cada subdocumento                              | Hay que declararlo en el schema del subdocumento. Probado: si no, un `replaceOne`, o un `$set` del array entero, borra los `_id` que Mongoose había guardado, porque un `z.object` descarta las keys que no declara. |
| `versionKey` (`__v`) y `optimisticConcurrency`             | No hay. Probado: un `replaceOne` borra el `__v` si el schema no lo declara. El control de versión sería un plugin.                                                                                                   |
| `select` en un campo, su proyección por defecto            | No hay. Sería un plugin de `read` que agregue la proyección.                                                                                                                                                         |
| `immutable`                                                | Solo `createdAt`, con `timestamps`. Otro campo sería un plugin que rechace los updates que lo escriben.                                                                                                              |
| Getters (`get`) al leer                                    | Las lecturas no se parsean en la v1: un virtual calcula un campo nuevo, pero no cambia uno guardado.                                                                                                                 |
| El nombre de la colección, pluralizado desde el del modelo | `collection` es explícito: hay que pasar el nombre que generó Mongoose, como `users` para el modelo `User`.                                                                                                          |

### El criterio de la v1, visto como librería

La propuesta dice: «una regla entra solo si cierra un hueco verificado que esos proyectos usan de
verdad, y ninguna capa existente lo cubre más barato» ([Objetivo](../proposal/README.md#objetivo)).

- **Para qué sirvió**: evitó sobrediseñar.
- **El problema**: como criterio de una librería, deja afuera API estándar de MongoDB que otros
  equipos usan.
- **Las decisiones que se tomaron con él**:
  - las referencias, solo de primer nivel;
  - los updates con pipeline, rechazados;
  - `mz.update`, solo con `$set`, `$unset` e `$inc`, sin `$push`, `$addToSet` ni `$pull`;
  - los virtuals, sin setters;
  - las lecturas, sin validar;
  - un `$set` con punto que crea padres incompletos, cubierto solo por el `$jsonSchema` opcional.
- **Lo que retiro de la primera pasada**: había marcado como sobre-ingeniería `$all`, `$size` y
  `$elemMatch` en `mz.filter`, y las claves comodín de los índices (`$**`), porque ningún proyecto
  los usa. Se quedan: son API estándar de MongoDB, y en `mz` cada campo los habilita a mano.
- **Propuesta para reformularlo**: «La API del modelo cubre lo que acepta el driver. Los tres
  proyectos marcan las prioridades y los casos de prueba, no el límite. Lo que la librería no
  soporta lanza un error claro y nunca falla en silencio».
- **Decidido**: la v1 es la versión con la que mongozod reemplaza a Mongoose, al menos en sus
  funciones principales, y la primera versión se publica recién entonces. El roadmap suma la fase 5,
  «Reemplazo de Mongoose», y la [propuesta](../proposal/README.md#objetivo) registra el criterio.

## Puntos a mejorar

En orden de prioridad. Los que dicen «decidir» cambian algo registrado en la propuesta.

### Corregir

1. **CI**: aceptar `!` en el patrón de
   [conventions.yml](../../.github/workflows/conventions.yml#L24), en las líneas 24 y 36
   (error 1). Hecho.
2. **Propuesta**: corregir la tabla de grupos de [operations.md](../proposal/operations.md#L8)
   (error 2). Hecho.
3. **`mz.filter`**: exigir `$regex` cuando viene `$options` (error 3), con un test contra MongoDB. Hecho.
4. **`references`**: rechazar en runtime una referencia que no es un campo de primer nivel, como
   hacen los tipos (error 4), con un test. Hecho.

### Antes de publicar la 0.x (fase 6)

5. **README** del paquete y de la raíz: qué es, cómo se instala, un ejemplo mínimo y que la API
   todavía puede cambiar en la 0.x (hueco 6).

### Decidir

6. **El criterio de la v1**, reformulado para una librería. Decidido: reemplazar a Mongoose en sus
   funciones principales.
7. **ObjectId**: un codec oficial, en un subpath que importe `bson`, o una receta (hueco 1).
   Decidido: `objectId()`, un codec en `mongozod/codecs/bson`, junto a `date()` en
   `mongozod/codecs/date`.
8. **El alcance de `populate`**: primero las referencias dentro de arrays de subdocumentos; después,
   opciones y varios niveles (hueco 2). Decidido: entran en la v1 los paths en subdocumentos y
   arrays, el anidado, `filter`, `sort` y el uno a muchos con `foreignField`; el valor pasa a ser
   `true` o `{ projection, filter, sort, populate }`.
9. **El driver 6** en el peer, para convivir con Mongoose 8 (hueco 3). Decidido: `^6.20.0 || ^7.0.0`.
10. **Los updates con pipeline**: dejarlos pasar con plugins y `timestamps`, o documentar
    `.collection` (hueco 5). Decidido: con la opción `updatePipeline: true`, como Mongoose 9.
11. **El casting de los filtros**: documentar la diferencia u ofrecer el parseo como opción
    (hueco 4). Decidido: documentar la diferencia; el casting queda en los inputs.
12. **`timestamps`** sin `.default()` obligatorio, con el tipo del insert ajustado por el núcleo
    (hallazgo 7). Decidido: sin `.default()`, con un overload para `timestamps: false`.

### Simplificar

13. **Unificar el recorrido de paths** de `schema-at.ts` y `update-path.ts`, y recorrer cada path una
    sola vez (hallazgo 5). Hecho.
14. **Juntar los helpers repetidos** en un solo lugar cada uno (hallazgo 6). Hecho.
15. **Derivar `SortDirection`** del tipo del driver (hallazgo 10). Hecho.
16. **Propuesta**: precisar que es Zod Mini el que no expone los enteros; opcional, usar `format`
    cuando existe (hallazgo 8). Hecho, sin `format`: la prueba con `0.5` ya sirve para los dos sabores
    de Zod, y un segundo camino no cambia el resultado.

### Documentación (fase 7)

17. **Guía «Desde Mongoose»**:
    - la tabla de equivalencias;
    - los huecos;
    - las recetas: ObjectId, el virtual `id`, el `_id` de los subdocumentos y `__v`;
    - los plugins que harían falta: proyección por defecto, campos inmutables y control de versión.
18. **Seguridad de los inputs**: un `$regex` o un `$in` que manda un cliente corren en el servidor.
    La guía tiene que recomendar `maxTimeMS` en las consultas y límites de tamaño en los requests.

### Prioridad baja

19. **Fijar la versión de Bun** en el CI (hallazgo 11).
20. **Revisar Turborepo y `packages/config`** cuando lleguen `examples/` (hallazgo 12).
