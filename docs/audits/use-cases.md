# 50 casos de uso como reemplazo de Mongoose

Una prueba de mongozod hecha por un desarrollador que deja Mongoose: 50 casos de uso, de lo más
normal a lo raro, escritos primero de la forma intuitiva, guiados por el JSDoc, los `.d.ts` y las
sugerencias del editor. Se hizo después de la fase 6.3 del [roadmap](../proposal/roadmap.md)
(commit `0c029cc`) y complementa la [evaluación anterior](./evaluation.md): lo que ya estaba
anotado ahí se marca como «ya anotado».

Cuatro preguntas:

1. **Utilidad**: ¿sirve para lo que hace una app real?
2. **Cobertura**: ¿cuántos casos resuelve con su API, sin bajar al driver?
3. **TypeScript**: ¿compila lo correcto y rechaza lo incorrecto? ¿Sugiere lo esperado? ¿Es rápido?
4. **DX**: ¿cuánta ceremonia pide? ¿Qué tan claros son sus errores? ¿Qué sorprende?

## Método

- **Instalación**: un proyecto aparte, fuera del repo, que instala mongozod desde el tarball de
  `pnpm pack`, con mongodb 7.7.0, zod 4.6.5, bson 7.3.3, TypeScript 7.0.2 y 5.5.4, y MongoDB 8.2.6
  (replica set de `mongodb-memory-server`).
- **Casos**: cuatro bloques. El A es el CRUD; el B, las relaciones y el modelado; el C, los
  endpoints y la API; y el D, los usos raros. Cada caso es un script que corre contra MongoDB, con
  `@ts-expect-error` para los errores típicos, y compila con TS 7 y 5.5.
- **Editor**: las sugerencias y el hover salen del LanguageService de TypeScript 5.5, en marcadores
  dentro de cada caso.
- **Costo de tipos**: `--extendedDiagnostics` por bloque y por archivo.
- **Verificación**: cada bug se reprodujo aparte, y los de severidad alta y media se volvieron a
  correr una segunda vez, fuera del bloque que los encontró.
- **Límite**: Mongoose no se instaló. Las comparaciones salen de su documentación, y la convivencia
  (caso 46) se simuló con documentos de su forma escritos con el driver.

## Resumen

- **Cubre los 50 casos**: 35 completos y 15 a medias, ninguno sin resolver. Solo bajan al driver
  los change streams (38) y las colecciones time-series o capped (47); las keys dinámicas de un
  record (43) piden un cast.
- **Es útil**: el CRUD, `populate` en todas sus formas, los subdocumentos, los virtuals,
  `softDelete`, los inputs de `mz` para endpoints, las transacciones, `bulkWrite`, geo, texto,
  `Decimal128`, UUID, TTL, las migraciones con `validationLevel` y la concurrencia optimista andan
  con menos sorpresas que en Mongoose y con mejores errores.
- **12 bugs**, todos verificados. Dos son de severidad alta: `populate` no le pasa el `context` al
  modelo de destino (B1), y `z.set()` se guarda como `{}` sin avisar (B2). El más visible para un
  equipo con dinero: no se puede debitar con `$inc` un `mz.decimal128()` que tiene un refine (B3).
- **El TS es correcto en el día a día y falla en los bordes**:
  - **Los errores**: son cortos y precisos.
  - **Las sugerencias**: los paths se sugieren hasta 6 niveles de profundidad.
  - **Lo que falla en los tipos**: el bug de `{ _id: 1 }` (B4); los utilitarios de TypeScript sobre
    los métodos del modelo, que dan TS2589; y el repositorio genérico, que no tiene un tipado sin
    casts.
- **El costo de tipos es bajo**: entre 0,04 y 0,2 s de check con TS 7 por bloque. Hay dos patrones
  caros nuevos: un `.map()` sobre una lectura con virtuals cuesta doce veces más (C1), y comparar un
  modelo contra `Model<any…>`, unas 100k a 254k instanciaciones (C2).
- **La DX promedia 3,8 de 5**. Lo que más se repite es que `instanceof ObjectId` falla con la mitad
  de los valores, en los cuatro bloques (F1). Le siguen los hovers ilegibles (ya anotado), los
  plugins que no pueden hacer un `pre('save')` ni dejar opcional el campo que completan, y los
  records, que no aceptan keys dinámicas.

| Bloque              | Casos | ✅ Cubre | 🟡 A medias | DX media | Instanciaciones TS 7 / 5.5 | Check TS 7 / 5.5 |
| ------------------- | ----- | -------- | ----------- | -------- | -------------------------- | ---------------- |
| A · CRUD            | 1–13  | 13       | 0           | 4,2      | 143.633 / 108.664          | 0,04 s / 0,31 s  |
| B · Relaciones      | 14–26 | 7        | 6           | 3,8      | 492.748 / –                | 0,21 s / –       |
| C · Endpoints y API | 27–38 | 8        | 4           | 3,6      | 426.445 / 782.558          | 0,22 s / 1,08 s  |
| D · Usos raros      | 39–50 | 7        | 5           | 3,8      | 392.244 / 325.202          | 0,12 s / 0,63 s  |
| **Total**           | 50    | **35**   | **15**      | **3,8**  |                            |                  |

El bloque C sin el repositorio genérico (C2) cuesta 155.520 / 113.197 instanciaciones y 0,05 s /
0,36 s.

## Casos

Cubre: ✅ con la API de mongozod, 🟡 a medias o con un rodeo, ❌ no. TS: ✅ correcto, 🟡 con fallas.
DX de 1 a 5. Los hallazgos remiten a la [lista de abajo](#hallazgos).

### A · CRUD (blog/SaaS)

| #   | Caso                                          | Cubre | TS  | DX  | Hallazgos    | Comentario                                                                                                                                                                                                       |
| --- | --------------------------------------------- | ----- | --- | --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modelo `User`, `sync()` y el `_id`            | ✅    | 🟡  | 4   | F1, F7, F25  | Sin declarar `_id`, el driver lo genera y la lectura lo tipa. `mz.objectId()` sin `.default()` exige el `_id` en cada insert; con default, pide importar `bson`. `sync()` es idempotente y reporta lo que sobra. |
| 2   | Insertar y leer por `_id`                     | ✅    | ✅  | 4   | F1, F24      | `insertOne` devuelve `insertedId` y `document`. Un hex en el filtro no compila; sin tipos devuelve `null` sin avisar (decidido). No hay `findById`.                                                              |
| 3   | Datos inválidos, error legible                | ✅    | 🟡  | 4   | F24          | `z.flattenError(e).fieldErrors` da la respuesta 400 en una línea. El error de una key de más nombra `Simplify<Omit<…>>`.                                                                                         |
| 4   | Email duplicado, 409                          | ✅    | ✅  | 5   | —            | El E11000 llega con `code` y `keyValue`, también en `$set` e `insertMany`.                                                                                                                                       |
| 5   | Listado con filtro, sort, skip, limit, total  | ✅    | 🟡  | 4   | F22          | `sort: '-createdAt'` no compila. No sugiere los operadores de query (ya anotado).                                                                                                                                |
| 6   | `$set` y `findOneAndUpdate` con `after`       | ✅    | 🟡  | 4   | B11, F24     | Valida con el path (`at $set.title`). `$set: { _id }` compila.                                                                                                                                                   |
| 7   | `$inc`, `$push`, `$pull`, `$addToSet`         | ✅    | 🟡  | 5   | —            | Todo anda, con `$each`, `$position` y `$slice`. Errores claros: `"title" is not an array`. `$inc: 0.5` en un entero compila (ya anotado).                                                                        |
| 8   | `deleteOne`, `deleteMany`, `findOneAndDelete` | ✅    | ✅  | 5   | —            | Igual que el driver; un typo en el filtro no compila.                                                                                                                                                            |
| 9   | Defaults, optional, nullable, nullish         | ✅    | 🟡  | 4   | F7, F15      | `undefined` nunca se guarda; `null` sí. Las lecturas se tipan bien. `Parameters<typeof M.insertOne>[0]` es `never`.                                                                                              |
| 10  | `timestamps: true`                            | ✅    | ✅  | 4   | F26          | Insert, update, upsert e `insertMany` bien; escribirlos no compila. `replaceOne` pisa `createdAt`.                                                                                                               |
| 11  | `countDocuments`, `distinct`, «¿existe?»      | ✅    | ❌  | 4   | B4           | `distinct` tipa bien. `projection: { _id: 1 }` se tipa como el documento entero.                                                                                                                                 |
| 12  | Upsert de settings con `$setOnInsert`         | ✅    | 🟡  | 4   | F27          | Los defaults se completan; 10 upserts concurrentes dejan uno. El mismo campo en `$set` y `$setOnInsert` compila.                                                                                                 |
| 13  | Proyección sin `password` y la inversa        | ✅    | 🟡  | 3   | B4, F14, F24 | `{ password: 0 }` lo quita del tipo. Una proyección en un `const` pide `as const`. No hay `select: false` (ya anotado).                                                                                          |

### B · Relaciones y modelado (blog/e-commerce)

| #   | Caso                                             | Cubre | TS  | DX  | Hallazgos   | Comentario                                                                                                                                                                        |
| --- | ------------------------------------------------ | ----- | --- | --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `references` y `populate` (`post.author`)        | ✅    | 🟡  | 4   | F1, F24     | `author: () => UsersModel`. Un autor que no existe da `null`, tipado. `populate: 'author'` no compila.                                                                            |
| 15  | `populate` de un array con `projection` y `sort` | ✅    | ✅  | 5   | —           | Conserva el orden guardado; `limit` por documento; el editor sugiere los campos del destino.                                                                                      |
| 16  | Uno a muchos (`user.posts`)                      | ✅    | ✅  | 5   | —           | `limit: 2` da 2 por usuario, no por lote: mejor que Mongoose. `limit` sin `sort` no compila y explica por qué.                                                                    |
| 17  | `populate` anidado y referencias circulares      | ✅    | ✅  | 5   | B1          | Tres niveles, tipados. User ↔ Post en archivos distintos compila sin TS7022.                                                                                                      |
| 18  | Subdocumentos con `$`, `arrayFilters` y `$pull`  | ✅    | 🟡  | 4   | F23         | El `_id` del ítem se genera si el schema lo declara con `.default()`; en Mongoose es automático. No sugiere dentro de `$pull`, `arrayFilters` ni `items.$.qty`.                   |
| 19  | Discriminators (`click` / `purchase`)            | 🟡    | 🟡  | 3   | F13         | Insert, narrowing y update chequeado andan. `find({ type: 'purchase' })` devuelve la unión entera.                                                                                |
| 20  | Virtuals (`fullName`)                            | ✅    | 🟡  | 4   | F16         | En lecturas, proyecciones y poblados. Un documento viejo que no pasa el virtual tumba el `find`.                                                                                  |
| 21  | `softDelete`                                     | ✅    | ✅  | 4   | F29         | Oculta en `find`, `count`, `distinct` y `populate`. Leer incluidos los borrados pide un `$or` largo.                                                                              |
| 22  | Plugin multi-tenant con `definePlugin`           | 🟡    | 🟡  | 3   | B1, F9, F10 | 17 líneas y hooks bien tipados. `populate` hacia el modelo falla siempre (B1), el insert exige `tenantId` y `aggregate` queda sin aislar.                                         |
| 23  | Hashear la password (`pre('save')`)              | 🟡    | ✅  | 3   | F8, F17     | El `before` corre antes de validar: `min(8)` valida el hash. Anda con `.transform(async hash)` en el campo, pero reescribir lo leído hashea el hash.                              |
| 24  | Validación entre campos (`.refine`)              | 🟡    | ✅  | 2   | F11         | Corre en insert, reemplazo y upsert; en `$set` no, aunque el update fije los dos campos.                                                                                          |
| 25  | Validación asíncrona (`.refine(async)`)          | 🟡    | ✅  | 4   | F12         | Anda en todas las escrituras, con el índice en los lotes. Dentro de una transacción no ve la sesión.                                                                              |
| 26  | Transforms (email, slug)                         | 🟡    | 🟡  | 3   | B8, F17     | `trim().toLowerCase()` anda. Un `.transform()` en la raíz se acepta en runtime y rompe los updates; el slug sale con `.overwrite()`, con la lectura tipada `string \| undefined`. |

### C · Endpoints y API (REST/tRPC)

| #   | Caso                                              | Cubre | TS  | DX  | Hallazgos | Comentario                                                                                                                                                              |
| --- | ------------------------------------------------- | ----- | --- | --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27  | Listado con `mz.filter`, `mz.sort` y `mz.after`   | ✅    | 🟡  | 4   | B5, F28   | 3 páginas con empates: 12 vistos, 12 únicos. El JSON del cliente llega convertido. `mz.after` acepta un campo array y pagina mal.                                       |
| 28  | Update con `mz.update` desde JSON                 | ✅    | 🟡  | 4   | B11, F20  | Pasa directo al modelo, sin casts; `$inc` sugiere solo los números. `$set: ['createdAt']` compila en `mz.update` y falla en el modelo con un error de 1.500 caracteres. |
| 29  | El cliente elige campos y relaciones              | ✅    | 🟡  | 4   | F24       | `mz.projection` y `mz.populate` con lista blanca andan. `populate: { account: {} }` da solo «Invalid input».                                                            |
| 30  | Id de la ruta a `ObjectId`                        | ✅    | ✅  | 4   | F21       | `mz.objectId().parse(id)` en una línea, con un `ZodError` claro. Molesta poco frente a `findById`.                                                                      |
| 31  | Serializar a JSON y round-trip                    | 🟡    | 🟡  | 3   | F1, F18   | `Decimal128` sale como `{"$numberDecimal": …}` y `mz.decimal128()` lo rechaza al volver. `z.encode` no sirve con proyecciones ni poblados.                              |
| 32  | Repositorio o `paginate` genérico                 | 🟡    | ❌  | 2   | F6, C2    | `Model<S>` da TS2345 y TS2589; `AnyModel` devuelve `Document`. Lo único sin casts: genérico sobre el resultado, con la consulta como callback.                          |
| 33  | DTOs y schema compartido con la web               | ✅    | 🟡  | 4   | F30       | `DocOf`, `ReadOf`, `Input` y `Output` dan lo esperado. `mongozod/mzod` no carga el driver en runtime, pero sus `.d.ts` cargan `mongodb.d.ts`.                           |
| 34  | `aggregate` con `$group` y `$lookup`              | ✅    | ✅  | 4   | F10       | Con `{ schema }` valida y tipa el resultado. El `$match` inicial se chequea. Sin plugins (decidido).                                                                    |
| 35  | Transferir saldo en una transacción               | 🟡    | ✅  | 3   | B3, F12   | El rollback con un `ZodError` anda. Con `balance: mz.decimal128().refine(>= 0)`, no se puede debitar con `$inc`.                                                        |
| 36  | `bulkWrite` mixto e `insertMany` `ordered: false` | ✅    | ✅  | 4   | F31       | Valida todo antes de escribir, con el índice de cada issue. Con `ordered: false`, un inválido rechaza el lote entero.                                                   |
| 37  | Recorrer 5k documentos                            | ✅    | ✅  | 4   | F32       | `for await` en 32 ms; `populate` por lote, rápido. El cursor no tiene `.map`, `.next` ni `.catch`.                                                                      |
| 38  | Change streams                                    | 🟡    | ✅  | 3   | F33       | No hay `Model.watch`; `Model.collection.watch()` está tipado por el driver (decidido).                                                                                  |

### D · Usos raros

| #   | Caso                                    | Cubre | TS  | DX  | Hallazgos   | Comentario                                                                                                                                                             |
| --- | --------------------------------------- | ----- | --- | --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 39  | Geo: `$near` y `$geoWithin`             | ✅    | 🟡  | 5   | F34         | `mz.point()` valida rangos; `sync()` crea el 2dsphere. Mejor que Mongoose. Los operadores geo compilan en cualquier campo.                                             |
| 40  | Texto con pesos y `textScore`           | ✅    | 🟡  | 4   | B10, F34    | `score: number` tipado. `{ title: { $meta } }` sobre un campo existente tipa `never`; los `weights` no se chequean.                                                    |
| 41  | Dinero con `mz.decimal128()`            | ✅    | 🟡  | 4   | B12, F18    | `$inc` y `$mul` exactos; `0.1 + 0.2` pide el string. `{ $gte: 10 }` no compila.                                                                                        |
| 42  | UUID como `_id`                         | ✅    | ✅  | 5   | —           | `z.uuid()` y `mz.uuid()` andan en todo, `populate` incluido.                                                                                                           |
| 43  | Claves dinámicas (`z.record`)           | 🟡    | 🟡  | 2   | B2, B7, F4  | Los paths literales andan. No se puede `$unset` una key; una key dinámica no compila; `z.map` se acepta y se guarda como objeto.                                       |
| 44  | Schemas recursivos                      | 🟡    | 🟡  | 3   | B6, F35     | Con getters de Zod 4 anda, con sugerencias hasta 6 niveles. `sync()` con `jsonSchema` da `RangeError`. Con `z.lazy` + `z.ZodType<T>` se pierden los paths.             |
| 45  | Documentos viejos que no cumplen        | ✅    | ✅  | 4   | F16, C1     | `validationLevel: 'moderate'`, la migración con pipeline y el paso a `strict` andan. Los tipos de lo leído mienten (decidido) y un virtual tumba el `find`.            |
| 46  | Convivir con Mongoose (simulado)        | ✅    | ✅  | 4   | F1          | `__v` y los `_id` de subdocumentos se conservan en `$set` puntuales; se pierden si un reemplazo no los declara.                                                        |
| 47  | TTL, parciales, collation, time-series  | 🟡    | 🟡  | 4   | F34, F36    | TTL, único parcial y case-insensitive con `sync()`. Time-series y capped van con el driver. `index({})` compila.                                                       |
| 48  | Multi-tenant por base, tests en memoria | 🟡    | ✅  | 3   | F5          | `db: () => …` se resuelve una vez: con `AsyncLocalStorage`, todos leen la base del primer tenant. Anda con un modelo por tenant.                                       |
| 49  | Concurrencia optimista                  | ✅    | 🟡  | 5   | —           | `version` en el filtro y `$inc`; 10 escritores, 1 gana. Un plugin de 30 líneas da el `VersionError` de Mongoose.                                                       |
| 50  | Los bordes                              | 🟡    | 🟡  | 3   | B11, F4, F6 | Keys con `.`/`$`, `items.0.name`, arrays de arrays, uniones no discriminadas y `null`/`$exists` bien; 40 campos y 4 niveles, bien. Las tuplas por índice no son paths. |

## Hallazgos

Tipos: **bug** hace algo distinto de lo que dicen sus tipos, su JSDoc o la propuesta; **fricción**
funciona pero cuesta o sorprende; **hueco** no se puede, o solo con el driver; **decidido** es un
comportamiento que la propuesta eligió a propósito y que igual molesta.

### Bugs

| Id  | Sev.  | Bug                                                                                                                                                                  | Casos     | Solución recomendada                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | alta  | `populate` no le pasa el `context` al modelo de destino. Un destino con un plugin que pide contexto en las lecturas siempre lanza `ZodError ["context"]`.            | 17, 22    | Reenviar el `context` de la lectura al `find` del destino, en `populateDocuments` y en los `populate` anidados, como ya se hace con la `session`: el contrato dice que quien llama manda un único `context` y cada plugin valida su parte. **Decidir:** si los tipos de la lectura piden ese `context` cuando un destino poblado lo exige, o solo lo aceptan (medir el costo). |
| B2  | alta  | El modelo acepta `z.set()` y `z.map()`. El driver guarda un `Set` como `{}`: pierde los valores sin avisar.                                                          | 43        | Al definir el modelo, lanzar un `Error` si el schema guarda un `z.set()` o un `z.map()`, con el path y la alternativa (`mz.set()`, `z.record()`), con el mismo recorrido que `bigintPath`. En los tipos, rechazarlos en `ModelSchema` con un mensaje.                                                                                                                          |
| B3  | media | `$inc` y `$mul` sobre un `mz.decimal128()` validan el delta con los refinements del campo.                                                                           | 35, 41    | En `$inc` y `$mul` sobre un decimal, parsear el delta con el codec de `mz.decimal128()` sin los checks del campo (un `mz.decimal128()` nuevo en vez del schema del campo), en el modelo y en `mz.update`. Test: un `.refine(>= 0)` acepta `$inc: '-10'`.                                                                                                                       |
| B4  | media | `projection: { _id: 1 }` se tipa como el documento entero.                                                                                                           | 11, 13    | En `types/projection.ts`, que `Mode` dé `'inclusion'` cuando la única entrada es `_id` incluido; `{ _id: 0 }` solo sigue siendo una exclusión. Test de tipos para `findOne`, `find` y `.project()`.                                                                                                                                                                            |
| B5  | media | `mz.after` acepta un campo array, y la paginación repite y saltea.                                                                                                   | 27        | En `mz.after`, rechazar en los tipos y en runtime un path cuyo schema guarda un array, con el mensaje `"tags" is an array: mz.after takes fields outside arrays`. El chequeo compartido con `mz.update` queda como está.                                                                                                                                                       |
| B6  | media | `sync()` con `jsonSchema` y un schema recursivo con getters lanza `RangeError: Maximum call stack size exceeded`.                                                    | 44        | En `json-schema.ts`, sumar los `z.object` al `seen` que hoy solo registra los `z.lazy`: un objeto que vuelve a aparecer en su propio recorrido queda sin regla, como `replies` con `z.lazy`.                                                                                                                                                                                   |
| B7  | media | No se puede hacer `$unset` de una key de `z.record(z.string(), X)`: los tipos y el runtime dicen que es obligatoria.                                                 | 43        | En el `$unset` del runtime y de los tipos, tratar como opcional una key de un record con keys `string` (no de un enum, cuyas keys sí son obligatorias): borrar una key de un record es válido. Test con `z.record(z.string(), z.string())`.                                                                                                                                    |
| B8  | baja  | Un `.transform()` en la raíz del schema no lanza un `Error` en runtime al definir el modelo. El insert anda y los updates fallan.                                    | 26        | Al definir el modelo, lanzar un `Error` si la raíz del schema no es un `z.object` ni una unión discriminada de objetos, con un mensaje que sugiera `.overwrite()` para un campo derivado. Es lo que AGENTS.md pide para una configuración inválida.                                                                                                                            |
| B9  | baja  | `findOne` con una proyección tipada `any` da TS2589, y `find` compila.                                                                                               | —         | Detectar una proyección `any` en `findOne` y devolver el documento sin proyectar, el mismo resultado que da `find`. Test de tipos.                                                                                                                                                                                                                                             |
| B10 | baja  | `{ title: { $meta: 'textScore' } }` sobre un campo existente tipa `never`.                                                                                           | 40        | Que `{ campo: { $meta } }` reemplace el tipo del campo por `number` en el resultado (MongoDB devuelve el score en ese campo).                                                                                                                                                                                                                                                  |
| B11 | baja  | `$set: { _id }` se sugiere y compila, en el modelo y en `mz.update`. El servidor lo rechaza (código 66), y sin `_id` en el schema el runtime dice que no es un path. | 6, 28, 50 | Rechazar `_id` en los tipos, las sugerencias y el runtime de `$set`, `$unset`, `$inc`, `$rename` y los demás operadores, en el modelo y en `mz.update`, con `"_id" is immutable`. `$setOnInsert` lo sigue aceptando, porque en un upsert MongoDB lo permite.                                                                                                                   |
| B12 | baja  | [Inputs](../proposal/inputs.md) #14 dice que un `$inc` con un número sobre un `Decimal128` suma el double; hoy es exacto. La doc está desactualizada.                | 41        | Corregir [Inputs](../proposal/inputs.md) #14: un número en un `$inc` sobre un decimal pasa por el codec y llega como `Decimal128`, así que la suma es exacta.                                                                                                                                                                                                                  |

**B1.** Es la combinación normal de un multi-tenant con relaciones. Los tipos aceptan la llamada y
no hay forma de pasar el contexto: en `references.ts` solo se reenvía la `session`.

```ts
const Members = mongozod({
  collection: 'm',
  db,
  plugins: [needsReadContext()],
  schema: memberSchema
})
const Projects = mongozod({ collection: 'p', db, references: { owner: () => Members }, schema })
await Projects.find({}, { populate: { owner: true } }) // compila → ZodError ["context"]
```

**B2.** El tipo de las lecturas dice `Set` y llega `{}`; reescribir lo leído lanza un `ZodError`.
Con `z.bigint()` sin `useBigInt64` la primera operación lanza un `Error`; con estos dos no hay
ningún aviso.

```ts
await M.insertOne({ s: new Set(['a', 'b']), m: new Map([['k', 1]]) })
// guardado: { s: {}, m: { k: 1 } }
```

**B3.** El caso del dinero, para el que existe `mz.decimal128()`. En `parse-update.ts`, el delta de
un decimal se parsea con el schema entero del campo (`parseEvery`). En un `z.number().min(0)`, al
revés, el `$inc` no valida nada y el valor queda negativo (decidido, como en Mongoose).

```ts
balance: mz.decimal128().refine((d) => Number(d.toString()) >= 0, 'balance cannot be negative')
await Accounts.updateOne({ name: 'x' }, { $inc: { balance: '-10' } }) // saldo 100 → ZodError
```

**B4.** Es la forma típica de preguntar «¿existe?». En `types/projection.ts`, `Mode<E>` ignora la
entrada del `_id`, y sin otras entradas cae en `'exclusion'`.

```ts
const a = await Users.findOne({}, { projection: { _id: 1 } }) // { _id }
const email: string = a!.email // compila; es undefined
```

**B5.** El JSDoc dice «each key is a required field outside arrays». El chequeo se comparte con
`mz.update`, donde un array entero sí es un destino válido.

```ts
mz.after(schema, { tags: 1, _id: 1 }) // compila y no lanza
// 6 documentos en páginas de 2: 7 vistos, 4 únicos
```

**B6.** El [modelo](../proposal/model.md#sincronización) dice que los recursivos quedan sin regla,
y con `z.lazy` es así. Con getters, la forma que recomienda Zod 4, el generador no corta la
recursión.

**B7.** El chequeo de `$unset` mira el schema del valor del record, cuando las keys de un record
con keys `string` nunca son obligatorias. Hoy se esquiva con `z.record(z.string(), X.optional())`.

### Costo de tipos

| Id  | Sev.  | Hallazgo                                                                                                                                                                                | Casos | Solución recomendada                                                                                                                                                                                                                                                                                 |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | media | Un `.map()` o `.filter()` sobre el resultado de `find` de un modelo con un virtual cuesta 96.297 instanciaciones, y `.length`, 8.198 (TS 7, verificado).                                | 45    | Investigar con el profiler de TS 6 qué re-instancia el `.map()` (los métodos del array sobre `Simplify<Pick<…> & VirtualValues<…>>`), y aplanar el documento con virtuals a un objeto antes de devolver el array. Sumar un `.map()` sobre una lectura con virtuals al proyecto de `check-type-cost`. |
| C2  | media | Comparar un modelo contra `Model<any, any, any, any, any>` cuesta unas 100k instanciaciones con TS 7 y 254k con 5.5, la primera vez. Es el camino al que lleva un repositorio genérico. | 32    | No optimizar `Model<any…>`: es el camino equivocado. La solución es F6, un patrón documentado para lo genérico, y medirlo en `check-type-cost`.                                                                                                                                                      |
| C3  | baja  | Un schema recursivo cuesta unas 95k instanciaciones solo por definir el modelo; 70k son de Zod.                                                                                         | 44    | Nada en mongozod: 70k son de Zod. La guía recomienda los getters (F35).                                                                                                                                                                                                                              |
| C4  | baja  | En los bloques A y D, TS 7 instancia más que TS 5.5 (143k contra 109k), al revés que el proyecto de `check-type-cost`. El tiempo igual es bajo.                                         | —     | Nada por ahora: el tiempo es bajo. Anotarlo en [Costo de los tipos](../proposal/types.md#costo-de-los-tipos) y volver a medir con el TS 7 siguiente.                                                                                                                                                 |

C1 sale de comparar los métodos del array, cuyo elemento es
`Simplify<Pick<…> & {…} & VirtualValues<…>>`.

### Fricciones, huecos y decididos

Ordenados por cuánto molestan a quien migra.

| Id  | Tipo     | Sev.  | Hallazgo                                                                                                                                                                                                                            | Casos            | Solución recomendada                                                                                                                                                                                                                                                                                            |
| --- | -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | fricción | media | Dos clases `ObjectId`, `Decimal128` y `UUID` en ESM: lo que crean `mz` y los defaults es de `bson` (ESM), y lo que lee el driver, de su build CJS. `instanceof` falla con la mitad de los valores. Apareció en los cuatro bloques.  | 1, 2, 14, 31, 46 | Guía y JSDoc de `mz.objectId()`: comparar con `.equals()` y chequear con `ObjectId.isValid`, nunca con `instanceof`; en el servidor, importar `ObjectId` de `mongodb`. No hay fix de código: las dos clases vienen de cómo se publica `bson`.                                                                   |
| F2  | decidido | media | Hovers ilegibles de las lecturas pobladas y proyectadas, de los `mz` y de `insertOne` (esconde `document`). Ya anotado, fase 7.                                                                                                     | 13, 14, 27, 33   | Fase 7, como ya está en el roadmap.                                                                                                                                                                                                                                                                             |
| F3  | decidido | media | El editor no sugiere los operadores de query, y las sugerencias de los updates no se filtran por operador. Ya anotado, fase 7.                                                                                                      | 5, 7             | Fase 7, como ya está en el roadmap.                                                                                                                                                                                                                                                                             |
| F4  | fricción | media | Una key dinámica (`` `metadata.${key}` ``) no compila ni en filtros ni en updates, tampoco en un record, donde es lo normal. Los elementos de una `z.tuple` (`pair.1`) no son paths.                                                | 43, 50           | Tipos: aceptar una key `` `${path}.${string}` `` cuando `path` es un record o un catchall, con el tipo de su valor; el runtime ya la valida. Un índice dentro del rango de una `z.tuple` es un path con el schema de esa posición. **Decidir:** cambia la regla de types.md de que una key `string` no compila. |
| F5  | decidido | alta  | `db: () => …` se resuelve una sola vez: un multi-tenant con `AsyncLocalStorage` lee la base del primer tenant en todos los requests, sin error.                                                                                     | 48               | JSDoc de `db` y guía: se resuelve una vez, y un multi-tenant por base usa un modelo por tenant con una fábrica y un cache. **Decidir:** si en cambio se resuelve en cada operación.                                                                                                                             |
| F6  | hueco    | media | No hay un tipado sin casts para un repositorio o un `paginate` genérico. `Awaited<ReturnType<typeof M.findOne>>` y `Parameters<typeof M.find>[0]` dan TS2589.                                                                       | 1, 32, 50        | Guía: el patrón genérico que compila sin casts (`ReadOf`, `FilterOf` con un genérico y la consulta como callback), y el JSDoc de `find` y `findOne` nombra `ReadOf`. **Decidir:** si `AnyModel` devuelve lecturas tipadas, después de medir su costo.                                                           |
| F7  | fricción | media | No hay un tipo del insert de un modelo: `Parameters<typeof M.insertOne>[0]` es `never`, e `Input<S>` pide los `timestamps`.                                                                                                         | 1, 9             | Exportar `InsertOf<typeof Model>`, el tipo del insert con los `timestamps` opcionales, junto a `DocOf` y `ReadOf`.                                                                                                                                                                                              |
| F8  | decidido | media | No hay un hook después de validar y antes de escribir (`pre('save')`): el `before` de un plugin ve la llamada sin validar. Un plugin que hashea cubre 7 operaciones a mano.                                                         | 23               | Guía: el equivalente de `pre('save')` es un `.transform(async)` en el campo, que valida y después transforma. No agregar un hook nuevo.                                                                                                                                                                         |
| F9  | fricción | media | El insert exige el campo que completa un plugin (`tenantId`, `createdBy`), aunque en runtime lo llena el plugin. `timestamps` sí lo deja opcional.                                                                                  | 22               | **Decidir:** una forma de que un plugin declare qué campos completa, para que el insert y el reemplazo los dejen opcionales como hace `timestamps`. Antes, buscar si Zod o el contrato actual ya lo expresan.                                                                                                   |
| F10 | decidido | media | `aggregate` no pasa por los plugins ni recibe `context`: un multi-tenant lo deja sin aislar, y `softDelete` cuenta los borrados en un `$group` o un `$lookup`.                                                                      | 22, 34           | Decirlo en el contrato de `context` de [Plugins](../proposal/plugins/README.md) como un riesgo de seguridad, y en el JSDoc de `aggregate`.                                                                                                                                                                      |
| F11 | hueco    | media | Un `.refine` entre campos no corre en `$set` ni en `findOneAndUpdate`, aunque el update fije los dos campos. Ya anotado como «hay que documentarlo», y no se documentó.                                                             | 24               | JSDoc de `updateOne`, `updateMany` y `findOneAndUpdate`, y [Operaciones](../proposal/operations.md): los `.refine` del objeto no corren en los updates; la receta es leer y `replaceOne`.                                                                                                                       |
| F12 | hueco    | media | Un `.refine(async)` que consulta la base no ve la sesión de la transacción. Una lectura sin `{ session }` dentro de `withTransaction` lee fuera de ella, sin aviso.                                                                 | 25, 35           | Guía: un refine no ve la sesión; el chequeo contra la base va en un `before` de un plugin, que sí recibe `args.options.session`.                                                                                                                                                                                |
| F13 | fricción | media | `find({ type: 'purchase' })` sobre una unión discriminada devuelve la unión entera; no hay un submodelo como `Event.discriminator()`.                                                                                               | 19               | Acotar el resultado de `find` y `findOne` con la lógica que ya usan los updates cuando el filtro fija el discriminador con una igualdad o un `$in`. Medir el costo de tipos antes de decidir.                                                                                                                   |
| F14 | fricción | media | Una proyección guardada en un `const` no compila sin `as const`, con un mensaje que dice que el campo «takes 0, 1…» cuando el valor es `0`.                                                                                         | 13               | Que el mensaje de una proyección con un `number` diga `write it as a literal: add as const`.                                                                                                                                                                                                                    |
| F15 | decidido | media | Un documento viejo sin un campo con `.default()` se lee sin él, con el tipo que dice que está. Mongoose aplica los defaults al leer.                                                                                                | 9, 45            | Guía de migración: agregar un campo con `.default()` pide migrar los documentos viejos.                                                                                                                                                                                                                         |
| F16 | decidido | media | Un solo documento viejo que no pasa un virtual hace fallar todo el `find`.                                                                                                                                                          | 20, 45           | Guía de migración, junto a F15: un documento que no pasa un virtual falla la lectura; listar los inválidos con `safeParse` antes de migrar.                                                                                                                                                                     |
| F17 | fricción | media | Un transform que no es idempotente (un hash, un slug) se vuelve a aplicar al reescribir lo leído. Un campo derivado de otro no tiene forma documentada: `.overwrite()` anda, con la lectura tipada `string \| undefined`.           | 23, 26           | Guía: recetas del hash (en el service, o idempotente) y del campo derivado con `.overwrite()`.                                                                                                                                                                                                                  |
| F18 | fricción | media | `JSON.stringify` da `{"$numberDecimal": …}` y `mz.decimal128()` lo rechaza al volver. `z.encode` no sirve con proyecciones ni poblados, y descarta el `_id` si el schema no lo declara. `{ $gte: 10 }` sobre un decimal no compila. | 31, 41           | Que `mz.decimal128()` acepte en su input la forma EJSON `{ $numberDecimal: string }`, así `res.json(doc)` vuelve sin `z.encode`. **Decidir** aparte si las comparaciones de un decimal aceptan `number`.                                                                                                        |
| F19 | fricción | baja  | `Model.find()` sin `.catch()`; un `ZodError` cuyo `message` es el JSON de los issues (ya anotado).                                                                                                                                  | 3, 5             | Guía: `z.prettifyError` para los logs. El cursor sigue sin `.catch` (se usa `try`/`await`).                                                                                                                                                                                                                     |
| F20 | fricción | media | Los `mz` toman el schema, no el modelo: `mz.update(schema, { $set: ['createdAt'] })` compila y falla en el modelo con un TS2769 de 1.500 caracteres, con el mensaje útil al final.                                                  | 28               | JSDoc de `mz.update`: los campos de `timestamps` no se declaran. El `_id` lo resuelve B11, y el orden del mensaje del modelo es de la fase 7.                                                                                                                                                                   |
| F21 | fricción | baja  | En un GET con query string, `mz.filter` no convierte `'1'` en número.                                                                                                                                                               | 30               | Guía de inputs: un GET manda el query como JSON (un parámetro `q`) o con un `z.preprocess`.                                                                                                                                                                                                                     |
| F22 | decidido | baja  | No sugiere los operadores de query: dentro de `{ views: { } }` aparecen los métodos de `Number` (F3).                                                                                                                               | 5                | Es F3.                                                                                                                                                                                                                                                                                                          |
| F23 | fricción | baja  | Sin sugerencias dentro de `$pull`, de `arrayFilters` ni de `items.$.qty` (sí `items.$[].qty`).                                                                                                                                      | 18               | Sugerir los campos del elemento dentro de `$pull` y de `arrayFilters`, y `items.$.qty` en `$set`. Medir el costo; si sube mucho, va a la fase 7 con F3.                                                                                                                                                         |
| F24 | fricción | baja  | Mensajes que confunden: un `mz.objectId()`, `mz.date()` o `mz.decimal128()` que falta dice «Invalid ObjectId» y no que falta; `populate: { x: {} }` da «Invalid input»; el error de una key de más nombra `Simplify<Omit<…>>`.      | 2, 3, 6, 29      | Cuando el valor es `undefined`, dejar el mensaje de Zod (`expected …, received undefined`) en vez del mensaje propio de `mz.objectId()`, `mz.date()` y `mz.decimal128()`. Que `mz.populate` con `{}` diga que espera `true` o un campo.                                                                         |
| F25 | fricción | baja  | El `_id` pide ceremonia: `mz.objectId()` sin `.default()` lo exige en cada insert, y con default pide importar `bson`. Sin declararlo anda, pero no hay una receta.                                                                 | 1                | Guía: receta del `_id` con sus tres formas (sin declarar, `mz.objectId().default(…)` y `z.uuidv4().default(…)`).                                                                                                                                                                                                |
| F26 | decidido | baja  | `replaceOne` pisa `createdAt` con «ahora»; el JSDoc no lo dice.                                                                                                                                                                     | 10               | JSDoc de `replaceOne` y `findOneAndReplace`: para conservar `createdAt`, se pasa el del documento.                                                                                                                                                                                                              |
| F27 | fricción | baja  | El mismo campo en `$set` y `$setOnInsert`, o en `$push` y `$pull`, compila y falla en el servidor (código 40). Un upsert al que le falta un campo obligatorio no menciona `$setOnInsert`.                                           | 12               | Que el error de un upsert al que le falta un campo obligatorio mencione `$setOnInsert`. Los conflictos entre operadores los sigue rechazando el servidor.                                                                                                                                                       |
| F28 | decidido | baja  | El sort de `mz.after` se escribe tres veces, y nada chequea que el `mz.sort` del cliente coincida con él.                                                                                                                           | 27               | Ninguna: está decidido.                                                                                                                                                                                                                                                                                         |
| F29 | decidido | baja  | Con `softDelete`, leer incluidos los borrados pide un `$or`; el restore con `$unset` no hace nada sin avisar; el `deleteOne` de `bulkWrite` cuenta como `modifiedCount`.                                                            | 21, 36           | Ninguna: está decidido. La guía muestra cómo leer incluidos los borrados.                                                                                                                                                                                                                                       |
| F30 | fricción | baja  | Los `.d.ts` de `mongozod/mzod` cargan `mongodb.d.ts`, aunque en runtime no lo importa.                                                                                                                                              | 33               | Que los tipos que usa `mongozod/mzod` importen `Document`, `BSONRegExp` y `Binary` de `bson`, no de `mongodb`.                                                                                                                                                                                                  |
| F31 | fricción | baja  | Con `ordered: false`, un documento inválido para Zod rechaza todo el lote; Mongoose inserta los válidos. No está escrito.                                                                                                           | 36               | JSDoc de `insertMany` y `bulkWrite`: con `ordered: false`, un documento inválido para Zod rechaza el lote entero.                                                                                                                                                                                               |
| F32 | decidido | baja  | El cursor no tiene `.map`, `.next`, `.hasNext`, `.forEach` ni `.batchSize()`; `for await` y `Readable.from` alcanzan.                                                                                                               | 37               | Ninguna: está decidido. La guía muestra `for await` y `Readable.from`.                                                                                                                                                                                                                                          |
| F33 | decidido | baja  | No hay `Model.watch`; `Model.collection.watch()` está tipado pero sin chequear el pipeline.                                                                                                                                         | 38               | Ninguna: está decidido. La guía muestra `Model.collection.watch()`.                                                                                                                                                                                                                                             |
| F34 | fricción | baja  | Opciones sin chequear: los operadores geo en cualquier campo, `index({})`, los `weights` de un índice de texto y `expireAfterSeconds` en un campo que no es fecha.                                                                  | 39, 40, 47       | Chequear las keys de `weights` como paths y rechazar `index({})` en los tipos. Los operadores geo siguen con las formas del driver.                                                                                                                                                                             |
| F35 | fricción | baja  | La recursión al estilo de Zod 3 (`z.ZodType<T>` + `z.lazy`) pierde los paths; con getters anda todo.                                                                                                                                | 44               | Guía: recomendar los getters de Zod 4 para los schemas recursivos.                                                                                                                                                                                                                                              |
| F36 | hueco    | baja  | Time-series, capped y la collation por defecto se crean con el driver; en una time-series, `sync()` reporta como sobrante el índice que MongoDB crea solo.                                                                          | 47               | Que `sync()` no cuente en `extraIndexes` el índice que MongoDB crea en una colección time-series.                                                                                                                                                                                                               |

## Correcciones

El 2026-10-12 se corrigieron los 12 bugs, se decidieron los puntos marcados **Decidir** y se
resolvieron las fricciones que piden código o JSDoc, cada una con su test, su changeset y su
documento de la propuesta. Las recetas que resuelven el resto quedan en la guía «Desde Mongoose» del
[roadmap](../proposal/roadmap.md).

| Hallazgo  | Commit    | Cómo                                                                                                                                                                                   |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1        | `964145c` | `populate` reenvía el `context` de la lectura, como la `session`.                                                                                                                      |
| B1 tipos  | `d9fd628` | Decidido: la lectura exige el `context` que piden los plugins de los modelos que puebla, también anidados, y el editor lo sugiere. +326 instanciaciones.                               |
| B2        | `4d29c27` | Un `z.set()` o un `z.map()` lanza un `Error` al definir el modelo, con el path y la alternativa. Solo en runtime: rechazarlo en los tipos pide recorrer todo el schema.                |
| B3 y B12  | `aad7089` | `$inc` y `$mul` sobre un decimal parsean el monto con el schema del campo sin sus checks, sin importar `bson` en `mz.update` (duplicaba un bundle web). La doc de Inputs quedó al día. |
| B4        | `8f60567` | Un `_id: 1` sin otras inclusiones ni exclusiones es una inclusión, también con `$slice` o `$meta`, como en MongoDB 8.2; lo usan los tipos, el plan de lectura y `populate`.            |
| B5        | `c5c7332` | `mz.after` rechaza un campo que guarda un array, en los tipos y al declararlo.                                                                                                         |
| B6        | `942a8c1` | El `$jsonSchema` corta la recursión en un objeto repetido, así los getters de Zod 4 quedan sin regla como `z.lazy`.                                                                    |
| B7        | `7d3376e` | `$unset` y `$rename` toman una key de un record sin un conjunto fijo de keys, de un `z.partialRecord` o de un catchall, con la regla de Zod.                                           |
| B8        | `6b50a22` | Un schema que no es un objeto ni una unión discriminada lanza un `Error` al definir el modelo, que sugiere `.overwrite()`.                                                             |
| B9        | `359714d` | Era cualquier lectura con una proyección `Document` o `any`, la primera de un archivo. Ahora compila con todos los campos opcionales.                                                  |
| B10       | `2a639ef` | `$meta` en un campo del documento lo tipa `number`, y en un path con punto no compila.                                                                                                 |
| B11       | `39913a5` | Solo `$setOnInsert` escribe el `_id`, en los tipos, las sugerencias y el runtime, también en `mz.update`.                                                                              |
| Extra     | `004bb3b` | El `Error` de `useBigInt64` salía solo en la primera operación.                                                                                                                        |
| C1        | `0646c67` | `VirtualValues`, `PopulatedValue` y `DocOf` ya no llevan la inferencia a los schemas ni a los modelos. El proyecto típico con tres `.map()` bajó de 272.784 a 65.138 instanciaciones.  |
| C4        | `ff52185` | Anotado en [Costo de los tipos](../proposal/types.md#costo-de-los-tipos).                                                                                                              |
| F4        | `c04b819` | Decidido: los índices de una `z.tuple` son paths. Las keys dinámicas compilan si el objeto tipa el patrón (microsoft/TypeScript#13948), documentado.                                   |
| F5        | `392b4b1` | Decidido: la función de `db` se llama en cada operación, con la colección guardada por `Db`.                                                                                           |
| F6        | —         | Decidido: un patrón documentado; un tipo para modelos genéricos costaba de 100.000 a 270.000 instanciaciones.                                                                          |
| F7        | `65d8b6b` | `InsertOf<typeof Model>`.                                                                                                                                                              |
| F9        | `2040236` | Decidido: `fills` en `definePlugin`, opcionales como los de `timestamps`.                                                                                                              |
| F13       | `7f337c1` | Decidido: las lecturas devuelven los tipos que permite el filtro, con la regla de los updates.                                                                                         |
| F14 y F24 | `783aa58` | El error de una proyección en una variable pide `as const`, y el de una key de más muestra los campos.                                                                                 |
| F18       | `d482ffe` | Decidido: `mz.decimal128()` toma su Extended JSON; los filtros no comparan un decimal con un `number`.                                                                                 |
| F23       | `2684ed7` | Sugiere `items.$.qty` y los campos del elemento en `$pull`; `arrayFilters` pasa a la fase 7.                                                                                           |
| F24       | `8041af2` | Un campo de `mz` que falta dice `received undefined`, y `mz.populate` dice qué toma.                                                                                                   |
| F27       | `ffff6ee` | Un campo que le falta al upsert apunta a `$setOnInsert`.                                                                                                                               |
| F30       | `2adb920` | Los `.d.ts` de `mongozod/mzod` toman sus tipos de `bson`.                                                                                                                              |
| F34       | `ae2877a` | `index({})` no compila, y los `weights` se chequean como paths.                                                                                                                        |
| F36       | `2252220` | `sync()` no cuenta el índice automático de una time-series.                                                                                                                            |
| JSDoc     | `ff52185` | F10, F11, F20, F26, F31 y `ReadOf` en `find`; F1 y F12 en `7528545`.                                                                                                                   |

## Lo que anduvo bien

- **Validación de updates**: los mensajes son mejores que los de Mongoose, que hace casi todo esto
  en silencio. Por ejemplo, `"title" is not an array`, `"status" is required, so it cannot be
  unset`, `"currency" is not in every type allowed: fix "type" in the filter` y `a limit needs a
  sort`.
- **`populate`**: cubre las referencias simples, los arrays, el uno a muchos con `limit` por
  documento, tres niveles de anidamiento y los modelos circulares entre archivos.
- **Inputs para endpoints**: los `mz` reciben el JSON del cliente, convierten hex, ISO y montos, y
  se pasan al modelo sin casts. La paginación por clave no repite ni saltea con empates.
- **Lotes y transacciones**: `bulkWrite` e `insertMany` validan todo antes de escribir, con el
  índice de cada issue. Una transacción hace rollback con un `ZodError`.
- **Tipos de datos**: geo, `Decimal128`, UUID, TTL, índices únicos parciales y case-insensitive
  andan, con la validación de la forma incluida.
- **Bordes**: `null`, `$exists`, arrays de arrays, uniones no discriminadas y las keys con `.` o
  `$` andan.
- **Schemas grandes**: uno de 40 campos y 4 niveles tiene sugerencias en todos sus paths por
  36.684 instanciaciones.
- **Migraciones**: andan con `validationLevel: 'moderate'`, un update con pipeline y el paso a
  `strict`.
- **Rendimiento**: recorrer 5.000 documentos con `for await` tarda 32 ms, y leerlos con `find`,
  18 ms contra 13 ms del driver solo.

## Qué arreglar primero

La columna «Solución recomendada» de cada tabla dice qué fix se aplicaría. Las marcadas con
**Decidir** cambian una regla de la propuesta o agregan API, así que pasan por un quiz antes de
escribir código. El orden propuesto:

1. **Los bugs B1 a B12**, antes de la 0.x, cada uno con su test y su commit `fix(mongozod): …`. B1
   y B2 son de severidad alta. B3, B4 y B5 afectan casos comunes: el dinero, el «¿existe?» y la
   paginación. B1 tiene una parte para decidir: si los tipos piden el `context` de los destinos.
2. **El costo de C1**, porque es un patrón de todos los días (un `.map()` sobre una lectura), con
   el caso sumado al proyecto de `check-type-cost`.
3. **Los fixes chicos sin decisión**: F7 (`InsertOf`), F14, F23, F24, F27, F30, F34 y F36, y el
   JSDoc de F10, F11, F20, F26 y F31.
4. **Los que piden un quiz**: B1 (los tipos), F4 (keys dinámicas y tuplas), F5 (`db` por
   operación), F6 (`AnyModel` tipado), F9 (los campos que completa un plugin), F13 (narrowing por
   el discriminador, después de medir su costo) y F18 (`Decimal128` en EJSON y comparaciones con
   `number`).
5. **La guía «Desde Mongoose»**, que ya está en el roadmap, con las recetas de F1, F5, F6, F8, F12,
   F15, F16, F17, F19, F21, F25, F29, F32, F33 y F35.
