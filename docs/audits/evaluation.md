# Evaluación antes de la primera versión

Una prueba de mongozod como lo usaría un equipo que deja Mongoose, después de la fase 6.2 del
[roadmap](../proposal/roadmap.md) (commit `1954e4c`). Tres preguntas:

1. **Paridad**: ¿cubre las funciones principales de Mongoose?
2. **Casos normales y bordes**: ¿hace lo que prometen sus docs con valores raros, carreras,
   transacciones y cursores?
3. **DX**: ¿qué tan fácil es usarlo, y qué tan claros son sus errores, sus tipos en el editor y sus
   sugerencias?

## Método

- **Instalación**: un proyecto aparte, fuera del repo, que instala mongozod desde el tarball de
  `pnpm pack`, como lo recibiría alguien desde npm, con mongodb 7.7, zod 4.6.5, bson 7.3.3,
  mongoose 9.11.1, TypeScript 7 y 5.9, y MongoDB 8.2.6 en memoria (replica set).
- **Paridad**: se recorrieron las guías oficiales de Mongoose
  ([mongoosejs.com/docs/guides](https://mongoosejs.com/docs/guides.html)) y se probó el equivalente
  de cada una, muchas veces corriendo el mismo escenario con Mongoose.
- **Bordes**: unos 30 scripts con valores, upserts, updates, errores, transacciones, cursores,
  plugins, `sync()` y tipos.
- **DX**: una tienda armada solo con el JSDoc publicado (todavía no hay README), los 15 errores
  más comunes de quien viene de Mongoose, y el editor con el LanguageService de TypeScript 5.9.
- **Verificación**: cada bug de este informe se volvió a correr aparte antes de anotarlo. Los
  comportamientos dudosos y los huecos vienen de los scripts de la evaluación, con su salida.

## Resumen

- **Reemplaza a Mongoose en lo principal.** Ninguna función principal de Mongoose queda sin
  equivalente: lo que falta es la API de documentos (`.save()`, `isModified`), que se dejó afuera a
  propósito, y opciones menores de los schemas. En validación de updates, tipos, `populate`,
  discriminators y `timestamps` hace más que Mongoose.
- **Hay 12 bugs, todos verificados.** El más visible: una lectura con proyección y una referencia uno
  a muchos pierde el `_id`. Cuatro están en el armado del documento de un upsert.
- **Dos huecos importantes que la propuesta no decidió**: las validaciones asíncronas de Zod rompen
  las escrituras, y `z.bigint()` promete en sus tipos un valor que el driver no devuelve.
- **La DX del día a día es mejor que la de Mongoose**: los errores de filtros, updates, `populate` y
  proyecciones son cortos y dicen qué y dónde, donde Mongoose compila casi todo y falla en runtime o
  en silencio. Lo flojo: tres hábitos de Mongoose (el `sort`, el `populate` y la `projection` en
  string) compilan; el editor no sugiere los operadores de query; los tipos poblados o proyectados
  se ven ilegibles al pasar el mouse; y los errores de configuración del modelo entierran el
  mensaje.
- **Los tipos cuestan mucho menos que los de Mongoose**: con TypeScript 7, los cinco modelos de
  Mongoose solos dan 559.725 instanciaciones, y la app entera de mongozod, con los mismos modelos y
  todo su uso, 78.904: siete veces menos.

## Bugs

Ordenados por impacto. Todos se reprodujeron aparte con el tarball.

1. **Una lectura con proyección de inclusión y una referencia uno a muchos pierde el `_id`.**
   `find({}, { projection: { name: 1 }, populate: { reviews: true } })` devuelve `{ name, reviews }`
   sin `_id`, aunque el tipo lo tiene. En `read-plan.ts`, cuando la inclusión no nombra `_id`, se lo
   pide y se lo marca para quitar después, como si fuera el `localField`, cuando MongoDB ya lo
   devuelve.
2. **Un reemplazo con upsert y `_id: null` en el filtro guarda un documento con `_id: null`**
   (`replaceOne`, `findOneAndReplace` y el `replaceOne` de `bulkWrite`). Solo se comprueba que el
   filtro tenga `_id`, no que su valor pase el schema. Es la parte de Mongoose
   [#9201](https://github.com/Automattic/mongoose/issues/9201) que no resolvemos. Los tipos lo
   rechazan; pasa con input sin tipos.
3. **Un upsert con `_id: undefined` en el filtro guarda `_id: null`**, en todas las operaciones con
   upsert. El `undefined` entra al documento armado, el `.default()` de Zod lo completa y la
   validación pasa, pero el driver manda el `undefined` como `null`. Es el caso de un
   `updateOne({ _id: input.id }, …, { upsert: true })` con un id que falta.
4. **Un upsert con un `RegExp` en el filtro lanza un `ZodError` falso.** Con
   `updateOne({ name: /^ab/ }, …, { upsert: true })`, mongozod toma la regex como una igualdad y la
   valida como el valor de `name`. MongoDB no la copia al documento. Compila.
5. **Un upsert valida un documento distinto del que guarda el servidor.** Con un transform, como
   `z.string().toLowerCase()`, Zod valida el email en minúsculas y el servidor guarda el del
   filtro. Con una igualdad sobre un subdocumento entero, los defaults de adentro no se agregan.
   Compila.
6. **`$rename` hacia un campo de otro tipo compila, y saltea el bloqueo de `timestamps`.**
   `$rename: { legacy: 'createdAt' }` guarda un string en `createdAt`. Los tipos comparan la salida
   del origen con la entrada del destino, y `mz.date()` acepta strings en su entrada. En runtime,
   el destino de `$rename` no pasa por el bloqueo de los campos de `timestamps`.
7. **Con `jsonSchema: true`, un schema con `.catchall()` y sin `_id` rechaza todos sus inserts.** El
   `$jsonSchema` no declara el `_id`, y el `additionalProperties` del catchall rechaza el `ObjectId`
   que genera el driver (código 121).
8. **Los tipos de `UpdateOf` fallan en un modelo con `timestamps` y referencias o plugins.** Una
   función genérica que pasa un update al modelo da TS2345, y con `softDelete` además TS2589.
   `TimestampsOf` infiere el modelo con las referencias y los plugins por defecto. No hay tests de
   `UpdateOf`.
9. **Los tipos rechazan un plugin con opciones después de uno sin opciones.**
   `plugins: [softDelete(), withOption]` dice que la opción es «de otro plugin».
10. **Una referencia que pasa por un record compila distinto de lo que hace en runtime.**
    `'byRole.$*'` no compila pero se acepta al definir el modelo, y `populate` deja los ids sin
    avisar. La propuesta dice que una referencia que no es un path del schema lanza un `Error`.
11. **Un `populate` sin tipos sobre una referencia cuyo campo no guarda ids deja el campo en
    `null`**: el valor guardado desaparece de la lectura. Al definir el modelo no se chequea que el
    campo guarde un id.
12. **`$currentDate` con `{ $type: 'timestamp' }` en un campo `Date` guarda un `Timestamp`** con
    input sin tipos. Los tipos lo rechazan.

### Correcciones

Los 12 se corrigieron, cada uno con su test, y los scripts de la evaluación se volvieron a correr
con un tarball nuevo:

| Bug   | Commit    | Cómo                                                                                                                                                                                                              |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `cda2a1e` | Una inclusión que no nombra el `_id` lo recibe del servidor: no se pide ni se quita.                                                                                                                              |
| 2–5   | `13d870b` | El upsert valida lo que copia el servidor: el `_id` del filtro en los reemplazos, sin `_id: null`, sin regex sueltas, `undefined` como `null`, y rechaza los valores del filtro que el schema guardaría distinto. |
| 6     | `25e6040` | `$rename` compara lo que guarda el origen con lo que guarda el destino, y su destino respeta `timestamps`.                                                                                                        |
| 7     | `4de4eb6` | El `$jsonSchema` declara el `_id` con un catchall y en cada tipo de una unión anidada.                                                                                                                            |
| 8     | `4ac6cb9` | `UpdateOf` lee los `timestamps` de una propiedad `~timestamps` que solo existe en los tipos.                                                                                                                      |
| 9     | `e299400` | Un plugin sin opciones no reserva todos los nombres.                                                                                                                                                              |
| 10–11 | `b3f9907` | Una referencia que pasa por un record, o cuyo campo guarda uno, lanza un `Error` al definir el modelo.                                                                                                            |
| 12    | `82c1bf8` | En runtime, `$currentDate` toma `true` o `{ $type: 'date' }`, como sus tipos.                                                                                                                                     |

## Huecos de paridad

- **Validaciones asíncronas (importante)**: un `.refine(async …)` en el schema hace que toda
  escritura lance `$ZodAsyncError` («Encountered Promise during synchronous parse»), que no es un
  `ZodError`. Mongoose acepta validators asíncronos, y se usan para chequear contra la base. La
  propuesta solo anota que ningún proyecto los usa. Hay que decidir: validar con `parseAsync` o
  rechazar al definir el modelo un schema con checks asíncronos.
- **`z.bigint()`, `Int32` y `Double` (importante)**: el tipo de la lectura dice `bigint`, pero el
  driver devuelve un `number`, o un `Long` para valores grandes, salvo que el cliente use
  `useBigInt64: true`; y un `Long` leído no vuelve a escribirse. El `$jsonSchema` los presenta como
  soportados. Hay que documentar `useBigInt64` o seguir el patrón de `mz.uuid()` con un tipo de
  campo propio.
- **`select: false`, `immutable` y `alias`**: un campo `password` que no se lee por defecto es muy
  común. La auditoría de las fases 1 a 4 los nombra como plugins posibles, pero no están en el
  roadmap.
- **Resueltos después de la evaluación**: las escrituras validan con `parseAsync`, así los
  refinements asíncronos funcionan en inserts, reemplazos, updates y `bulkWrite` (`305244c`); y un
  `z.bigint()` exige `useBigInt64: true` en el cliente o el `Db`, o la primera operación lanza un
  `Error` con el path (`6d11466`).
- **Menores, sin planificar**: `timestamps` en subdocumentos y `currentTime`, `populate` de Maps y su
  opción `transform`, `Model.populate()` sobre documentos ya leídos, la collation por defecto y los
  plugins globales.
- **Validaciones entre campos**: un `.refine` del objeto corre en el insert y en el upsert, pero no
  en un `$set`. Mongoose hace lo mismo; hay que documentarlo.

## Comportamientos dudosos

- **`$inc` sobre `mz.decimal128()` no se acepta**, ni en los tipos ni en runtime (`"balance" is not
  a number`), y MongoDB sí lo aplica. Es el caso típico del dinero.
- **`$inc` con `NaN` y `$mul` con `Infinity`** se guardan en un `z.number()`, que el insert rechaza.
- **Los tipos no rechazan `$inc: 0.5` en un campo entero**; el runtime sí. Tampoco aceptan un
  bigint en `$inc` sobre un `z.bigint()`, que en runtime funciona.
- **`insertMany` y `bulkWrite` informan solo el primer documento inválido, sin su índice** en el
  path. No escriben nada, que es lo correcto.
- **`ModelCursor.close()` antes de leer**, y después un `await`, devuelve los documentos; el driver
  devuelve ninguno.
- **`populate` comparte la instancia del documento poblado** entre los documentos que lo
  referencian: mutar uno cambia el otro.
- **Configuraciones inválidas sin tipos dan un `TypeError`**, como una operación desconocida en
  `bulkWrite` o `mz.update` con un objeto en vez de un array, donde los docs prometen un `Error`
  con nombre.
- **Un array `readonly`** (de un `as const`) no compila en `insertOne`.

## DX

### Errores de compilación

De los 15 errores típicos de quien viene de Mongoose, 12 dan un mensaje corto, de 100 a 180
caracteres, que dice qué está mal y dónde. Por ejemplo:

| Error                            | mongozod                                                               | Mongoose                   |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| Typo en un filtro                | `"emial" is not a path of the document`                                | Compila y devuelve `[]`    |
| Operador desconocido             | `"$between" is not a query operator`                                   | Error de overload engañoso |
| Update sin operador              | `"name" is not an update operator`                                     | Lo envuelve en `$set`      |
| Update del discriminador         | `"method" changes the type of its object: replace the object`          | No hace nada, en silencio  |
| Escribir `updatedAt`             | `"updatedAt" is set by timestamps: pass timestamps: false to write it` | Lo pisa en silencio        |
| `populate` de algo que no es ref | `"status" is not a reference of the model`                             | Lo ignora en silencio      |

Lo que falla:

- **El `sort`, el `populate` y la `projection` en string compilan.** `sort: '-createdAt'` ordena
  por un campo que no existe, en silencio; el `populate` y la `projection` en string fallan recién
  en runtime. Son los únicos hábitos de Mongoose que no frena el compilador.
- **Un string en un campo `ObjectId` del filtro** da `Type 'string' is not assignable to type
  'ObjectId'`, sin decir cómo convertirlo.
- **Los errores de configuración del modelo son largos**: `softDelete` sin `deletedAt` o
  `timestamps` sin sus campos dan unos 870 caracteres, y una referencia inexistente 1.039; el
  mensaje útil queda en la segunda línea o al final.

### Editor

- **Bien**: las sugerencias de paths en filtros, `sort`, proyecciones, `populate` y los paths de
  arrays de un update; los operadores de update; y los campos del resultado de una proyección.
- **No sugiere los operadores de query** (`$gte`, `$in`…): dentro de `{ stock: { | } }` aparecen
  los métodos de `Number`. Mongoose sí los sugiere, y la propuesta dice que el editor los sugiere.
- **No filtra los paths por operador** en los updates del modelo: `$inc` sugiere strings, aunque
  `mz.update` ya tiene esa lógica.
- **Los tipos de una lectura proyectada o poblada son ilegibles al pasar el mouse**: muestran
  `Simplify<MetaFields<Entries<…>>>` o `PopulatedValue<ObjectId, () => Model<ZodObject<…` en vez
  de los campos. El autocompletado sí los conoce.

### Runtime

- **El `ZodError` de las escrituras tiene los paths correctos**, como `["$set", "stock"]` o
  `["tags", 1]`, y los mensajes propios son claros.
- **Su `message` es el JSON de los issues**, de 12 a 30 líneas, con regex completos, y no nombra el
  modelo ni la operación. `z.prettifyError(error)` da una salida mucho mejor, pero no está
  documentado.
- **Los filtros no se validan en runtime**: un typo o un string en vez de un `ObjectId` que llega
  sin tipos devuelve `[]` en silencio. Es la decisión de no castear; la guía tiene que decir que
  para eso está `mz.filter`.

### Primer uso

- **Fue fácil**: las referencias con `() => Model`, también circulares, las uno a muchos, los
  virtuals, los inputs con `mz` y pasar su salida directo a `find`. La tienda compiló y corrió al
  primer intento, salvo por el bug 1.
- **Costó**: no hay un tipo exportado para el documento de una lectura con `populate`; el ejemplo
  de `softDelete()` no muestra que el schema necesita `deletedAt`; no hay un ejemplo de
  transacción; y los ejemplos del JSDoc empiezan con un `;` que dejó el formateador. El de
  `objectId()` no compila (`owner: objectId()` sin `mz.`).
- **Líneas**: los mismos cinco modelos ocupan 120 líneas con mongozod y 83 con Mongoose. La
  diferencia es el `_id` con su `.default()` y los campos de `timestamps`, que se declaran.

### Mejoras hechas

- **Los strings de Mongoose** (`66bedc9`): un `sort`, una `projection` o un `populate` en string no
  compilan, y el `sort` y la `projection` lanzan un `ZodError` en runtime.
- **`$inc` y `$mul` en `Decimal128`** (`c50f726`): el valor se parsea con el schema del campo, así un
  `'0.10'` llega exacto, también por `mz.update`.
- **Los lotes** (`6b0c980`): `insertMany` y `bulkWrite` lanzan un solo `ZodError` con los issues de
  todos los documentos u operaciones que fallan, cada uno bajo su índice.
- **`ReadOf<M, O>`** (`ef4122e`): el documento que devuelve una lectura con su `projection` y su
  `populate`, para tipar services y respuestas.
- **El JSDoc** (`80d82f2`): sin el `;` de las cercas, con el ejemplo de `mz.objectId()` que compila,
  el de `find` con su `projection`, el de `softDelete()` con `deletedAt` y uno de transacción.

### Para después de la 0.x

Las sugerencias de los operadores de query, los tipos legibles al pasar el mouse, los errores de
configuración del modelo con el mensaje primero y las sugerencias de los updates filtradas por
operador. Son más caras y hay que medir su costo de tipos; quedan en la fase 7 del roadmap.

## El costo de los tipos

Después de las correcciones, el proyecto típico de `pnpm check-type-cost` usaba el 95 % de sus dos
límites. Once cambios (`18e8dfe` a `1e29eaa`) lo bajan casi una cuarta parte sin cambiar lo que
compila, los mensajes de mongozod ni las sugerencias del editor:

| Medida                                             | Antes            | Después             |
| -------------------------------------------------- | ---------------- | ------------------- |
| Proyecto típico, TypeScript 7                      | 80.739           | 62.316 (−22,8 %)    |
| Proyecto típico, TypeScript 5.5                    | 90.434           | 69.193 (−23,5 %)    |
| `check-types` del paquete, TypeScript 7            | 2.537.645        | 2.260.208 (−10,9 %) |
| Tiempo de chequeo del proyecto, TypeScript 7 y 5.5 | 0,057 s y 0,24 s | 0,044 s y 0,21 s    |

- **Las causas**: intersecciones de dos arrays, que hacen comparar cada método de los dos (las
  sugerencias de `mz.filter` y `mz.update`, y `arrayFilters` contra `Document[]`);
  `Pick<T, K> extends Required<Pick<T, K>>` para saber si una key es opcional; chequeos que
  TypeScript repite mientras infiere; y recorridos de más. Las reglas quedaron en
  [Costo de los tipos](../proposal/types.md#costo-de-los-tipos).
- **Cómo se midió**: el proyecto partido por operación, cada tipo reemplazado por uno trivial, y
  copias instrumentadas de TypeScript 5.5 y 6.0.3, que cuenta casi igual que TypeScript 7 (81.013
  contra 80.739), para atribuir cada instanciación al tipo de mongozod que la causa.
- **El límite** baja a 67.000 y 74.000, un 7 % sobre lo medido.
- **Lo que queda**: el mismo proyecto con el driver solo cuesta 10.179 instanciaciones con
  TypeScript 7, y mongozod con sus chequeos, resultados y sugerencias reemplazados por tipos
  triviales, 18.788. El resto es el trabajo de esas funciones, como unas 300 instanciaciones por key
  de un filtro. Quedan dos pistas sin rediseñar: el chequeo de proyecciones, unas 560 por key con
  TypeScript 7, y el `WithId` que arma `populate` para leer el `_id` del destino.
- **Quedó afuera**: `ModelSchema` con `core.$ZodObject<any, any>` ahorraba 1.156 y 1.680 más, pero
  pedía una excepción del lint para `any`.

## Lo que funciona

- **Mongoose [#8505](https://github.com/Automattic/mongoose/issues/8505)**: los objetos y arrays
  vacíos se guardan, en el insert y en el `$set`.
- **Mongoose [#9201](https://github.com/Automattic/mongoose/issues/9201)**: resuelto en los updates
  con upsert, no en los reemplazos (bug 2).
- **Validación**: `undefined` se descarta y `null` solo entra en un campo nullable; las fechas, los
  `ObjectId` y los `Decimal128` inválidos dan un solo issue; `NaN` e `Infinity` se rechazan en el
  insert.
- **Tamaños y anidamiento**: un documento de 15,9 MiB entra y el error del driver de 16 MiB se
  propaga; 150 niveles de anidamiento funcionan.
- **Updates**: `$`, `$[]`, `$[id]`, arrays anidados, `$push` con sus modificadores, uniones anidadas
  con sus reglas, `bulkWrite` mezclado y pipelines con `updatePipeline: true`.
- **Errores**: el E11000 se propaga con `keyValue`, el 121 del `$jsonSchema` con `errInfo`, y los
  errores de plugins funcionan.
- **`sync()`**: idempotente y atómico ante índices en conflicto (85 y 86 sin crear ninguno).
- **Transacciones**: `populate` ve las escrituras sin confirmar, y un `ZodError` aborta sin dejar
  nada.
- **Cursores**: encadenar modificadores, un `break` que cierra el cursor del servidor, y `populate`
  con una consulta por lote.
- **`softDelete`** con índices únicos parciales, y **`timestamps`** en upserts y `bulkWrite`.
- **Concurrencia**: 20 upserts concurrentes con índice único dejan un documento.
- **Convivencia con Mongoose**: un modelo de mongozod sobre la conexión de Mongoose, con una
  transacción compartida.
