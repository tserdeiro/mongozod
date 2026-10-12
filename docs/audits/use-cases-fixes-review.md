# Auditoría de las correcciones de los 50 casos de uso

Una revisión crítica de los commits que aplicaron los fixes de los
[50 casos de uso](./use-cases.md) (`e237766..a563825`, sobre `0c029cc`): si cada uno resuelve su
hallazgo, si rompe algo vecino, si tipos y runtime coinciden, y si cumple
[AGENTS.md](../../AGENTS.md) y la [propuesta](../proposal/README.md).

## Método

- **Chequeos del repo** en `a563825`: `pnpm test` (298 tests), `check-types`, `build`,
  `check-dist-types` y `check-type-cost` (65.532 de 70.000 con TS 7 y 73.379 de 78.000 con 5.5)
  pasan. `pnpm format` y `pnpm lint` fallan solo por dos worktrees de agentes que quedaron en
  `.claude/worktrees/` (en `0c029cc`, sin trackear); sobre los archivos trackeados pasan.
- **Los 50 casos otra vez**: el proyecto de la evaluación con un tarball nuevo de `a563825`. Los
  cambios de tipos son los esperados (cada `@ts-expect-error` que sobra es un bug corregido, cada
  error nuevo es una línea que los casos escribían mal a propósito) y en runtime no hay regresiones:
  lo único que falla es lo que ahora se rechaza a propósito (B2, B5, B8).
- **Cuatro revisiones**, una por área, contra el tarball, MongoDB 8.2.6 y TS 7 y 5.5, buscando
  variantes de cada fix y regresiones.
- **Verificación**: cada hallazgo de severidad alta o media se reprodujo dos veces, en la revisión
  y aparte.

## Resumen

- **Los 29 commits resuelven su hallazgo original.** Ninguno rompe los 50 casos.
- **Hay un bug nuevo de severidad alta**, en el narrowing de las lecturas (`7f337c1`): con un
  discriminador `z.enum([...])`, los tipos mienten y el código crashea en runtime.
- **Hay 11 hallazgos de severidad media**: dos regresiones (los `fills` de un plugin anotado como
  `Plugin`, y las sugerencias de los índices), cuatro fixes incompletos y cinco casos que el fix no
  cubría.
- **De proceso**: la decisión de F6 no quedó en la propuesta, C2 no se midió en `check-type-cost`,
  y quedaron dos worktrees que rompen `pnpm format` y `pnpm lint`.

| Commit    | Hallazgo      | Veredicto | Observaciones |
| --------- | ------------- | --------- | ------------- |
| `964145c` | B1            | ✅        |               |
| `d9fd628` | B1 tipos      | ✅        |               |
| `4d29c27` | B2            | ✅        | R13           |
| `aad7089` | B3, B12       | 🟡        | R8, R14       |
| `8f60567` | B4            | ✅        | R15           |
| `c5c7332` | B5            | ✅        | R16           |
| `942a8c1` | B6            | ✅        |               |
| `7d3376e` | B7            | 🟡        | R17           |
| `6b50a22` | B8            | ✅        | R18           |
| `359714d` | B9            | 🟡        | R5, R19       |
| `2a639ef` | B10           | 🟡        | R6            |
| `39913a5` | B11           | 🟡        | R9            |
| `004bb3b` | extra         | ✅        |               |
| `0646c67` | C1            | ✅        | R20           |
| `c04b819` | F4            | 🟡        | R10           |
| `392b4b1` | F5            | 🟡        | R4, R21       |
| `65d8b6b` | F7            | ✅        |               |
| `2040236` | F9            | 🟡        | R2, R22       |
| `7f337c1` | F13           | ❌        | R1            |
| `783aa58` | F14, F24      | 🟡        | R7, R23       |
| `d482ffe` | F18           | ✅        | R24           |
| `2684ed7` | F23           | 🟡        | R25           |
| `ffff6ee` | F27           | ✅        |               |
| `8041af2` | F24           | ✅        | R26           |
| `2adb920` | F30           | ✅        | R27           |
| `ae2877a` | F34           | 🟡        | R3, R28       |
| `2252220` | F36           | ✅        |               |
| `ff52185` | JSDoc, C4     | ✅        |               |
| `7528545` | JSDoc F1, F12 | ✅        |               |
| `a563825` | registro      | 🟡        | R11, R12      |

## Lo que salió bien

- **B1**: el `context` llega a cada plugin del destino, con su parte, en `find`, `findOne`,
  cursores, `findOneAndUpdate`, `findOneAndReplace`, `findOneAndDelete`, populate anidado y uno a
  muchos con `limit`. Los tipos lo piden y el editor sugiere sus keys, sin TS2589 ni TS7022 en
  referencias circulares.
- **B4**: `{ _id: 1 }` solo, con `$slice` o `$meta`, `{ _id: 0 }`, `{ _id: 1, email: 0 }`,
  `.project()`, virtuals y populate: MongoDB, el plan de lectura y el tipo coinciden.
- **B6**: la regresión que había que descartar no está. El mismo `addressSchema` en seis lugares
  conserva su regla en el validator; solo se corta un objeto que es su propio ancestro.
- **B2 y B8**: sin falsos positivos con `.extend`, `.strict`, `z.looseObject`, uniones anidadas,
  Zod Mini, `mz.set()` ni `z.record()`.
- **C1**: un `.map()` sobre una lectura con virtual bajó de 96.297 a unas 8.000 instanciaciones, y
  los hovers muestran `{ label: string }` en vez de `VirtualValues<…>`.
- **F5**: con `AsyncLocalStorage` cada operación va a la base del tenant, también en una
  transacción; el cache es un `WeakMap<Db, Collection>`, sin fuga.
- **F30**: `tsc --listFiles` de un consumidor de `mongozod/mzod` carga `bson.d.ts` y nada de
  `mongodb`.
- **Docs**: cada afirmación nueva del JSDoc se probó contra el runtime y es verdad. Los 29 SHAs de la
  tabla «Correcciones» existen y hacen lo que dicen, y hay un changeset por commit publicado.
- **Tests**: los de B1, F5, F9 y el `useBigInt64` fallarían sin su fix.

## Hallazgos

### Alta

**R1. El narrowing de las lecturas falla con un discriminador `z.enum([...])`** (`7f337c1`). Una
lectura de un tipo que existe se tipa `never[]`, y un `$in` que deja pasar dos tipos se tipa como
uno solo, así que el código compila y crashea:

```ts
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: z.number() }),
  z.object({ type: z.enum(['view', 'impression']), url: z.string() })
])
const views = await Events.find({ type: 'view' }) // never[]; en runtime, 1 view
const both = await Events.find({ type: { $in: ['click', 'view'] } }) // tipado solo como click
for (const d of both) d.x.toFixed() // compila; TypeError: Cannot read properties of undefined
```

Pasa también en el `filter` de `populate`. `OptionWith` pide que la salida del discriminador de
la opción sea parte de los valores fijados (`output extends V`), cuando alcanza con que se crucen.
La regla viene de los updates, donde ya fallaba antes:
`updateOne({ type: 'view' }, { $set: { url } })` da `no type matches the filter`.

**Corrección**: una opción queda si su discriminador se cruza con los valores fijados
(`[Extract<output, V>] extends [never] ? never : O`), en las lecturas y en los updates, con un
test de un discriminador `z.enum`.

### Media

| Id  | Commit    | Hallazgo                                                                                                                                                                                                                                                | Corrección                                                                                                                                       |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| R2  | `2040236` | **Regresión de tipos.** El default de `Fills` en la interfaz `Plugin` son todos sus `fields`: con `plugins: Plugin[]`, `PluginFills` es `string` y todo el insert queda opcional; `insertOne({ _id: 'x' })` compila sin el `title` obligatorio.         | El default de `Fills` en `Plugin` es `readonly []`, como en `definePlugin`, y `FillsOfPlugin` descarta `string extends K`.                       |
| R3  | `ae2877a` | **Regresión de DX.** El editor ofrece `"an index takes at least one key"` como primera key de todo `index({ … })`, también con keys escritas; elegirla da un error. Viene de la propiedad que rechaza `index({})`.                                      | Rechazar el índice vacío solo en runtime, que ya lo hace, o con un chequeo que no sea una propiedad del objeto.                                  |
| R4  | `392b4b1` | `find()` y `aggregate()` resuelven la función de `db` al iterar: un cursor creado dentro del `run` de un tenant y leído afuera lee la base por defecto, sin error. El cursor del driver queda atado a su colección al crearse.                          | Resolver el `Db` al crear el cursor y pasarlo a la consulta.                                                                                     |
| R5  | `359714d` | Una proyección `Document` o `any` con `populate` sigue sin compilar (`populate needs "author": the projection excludes it`), aunque el changeset dice que compila. `ExcludedBy` y `KeepsPopulated` hacen `[any] extends [0 \| false]`.                  | Saltear `IsAny` en esos dos chequeos.                                                                                                            |
| R6  | `2a639ef` | Un `$meta` sobre un campo que lee un virtual compila y en runtime lanza `ZodError` (el virtual se calcula sobre el score). Con `{ name: { $meta }, label: 1 }`, compila y lo rechaza el plan de lectura.                                                | Un `$meta` sobre un campo que lee un virtual cuenta como cambiarlo, como `$slice`: en `Changed`, en `Touched` y en el plan de lectura.           |
| R7  | `783aa58` | Mientras se escribe una proyección anidada, `{ meta: { \| } }` da `"meta" is a number, which a projection kept in a variable gets: declare it with as const` y el editor sugiere los métodos de `String`: `number extends P[K]` es verdadero para `{}`. | Dar el mensaje de `as const` solo con `[P[K]] extends [number]`, y a `{}` el suyo: `"meta" takes a field inside: an empty sub-projection fails`. |
| R8  | `aad7089` | Al sacar los checks del monto, `$inc: { balance: 'NaN' }` (o `'Infinity'`, o `{ $numberDecimal: 'NaN' }`) guarda NaN, aunque el campo tenga un `.refine(>= 0)` que antes lo frenaba. La causa es anterior: `mz.decimal128()` acepta los no finitos.     | Que `mz.decimal128()` rechace NaN e Infinity, o al menos el monto de `$inc` y `$mul`.                                                            |
| R9  | `39913a5` | `$setOnInsert: { '_id.sub': … }` con un `_id` objeto compila y pasa la validación, y MongoDB 8.2 lo rechaza siempre con el código 66. El mensaje de `$set: { '_id.sub' }` recomienda justamente `$setOnInsert`.                                         | En `$setOnInsert`, aceptar solo el `_id` entero, y que el mensaje lo diga.                                                                       |
| R10 | `c04b819` | Con los índices de una tupla como paths, `$unset: { 'pair.1': '' }` sobre un elemento opcional guarda `["x", null]`, que el schema rechaza. Con un array común ya pasaba (`arr.0`); el commit lo extiende a las tuplas.                                 | Rechazar `$unset`, y el origen de `$rename`, sobre un índice cuyo elemento no acepta `null`.                                                     |
| R11 | `a563825` | F6 figura «Decidido» en la tabla «Correcciones», pero la decisión (sin un tipo para modelos genéricos, por su costo) no está en ningún documento de `docs/proposal/`; AGENTS.md pide anotarla en el de su tema.                                         | Un párrafo en [Tipos](../proposal/types.md), con la receta y el costo medido.                                                                    |
| R12 | —         | Dos worktrees de agentes en `.claude/worktrees/` (en `0c029cc`) hacen fallar `pnpm format` y `pnpm lint` desde la raíz.                                                                                                                                 | Borrarlos (`git worktree remove`), o ignorar `.claude/` en oxlint y oxfmt.                                                                       |

### Baja

| Id  | Commit    | Hallazgo                                                                                                                                                                                                                                                                                |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R13 | `4d29c27` | Un `.transform()` que devuelve un `Set`, o un `z.instanceof(Set)`, pasan el chequeo y guardan `{}`; en una tupla el error nombra la tupla y no el elemento.                                                                                                                             |
| R14 | `aad7089` | Un refine en una opción de una unión (`z.union([decimal.refine(…), z.null()])`) sigue aplicándose al monto; `$inc: null` pasa la validación y lo rechaza el servidor.                                                                                                                   |
| R15 | `8f60567` | Anterior al commit: con un `foreignField` con punto, `keepingField` da `Path collision` con `{ ref: 1 }`, y con `{ text: 1 }` deja un `ref: {}` que el tipo no tiene.                                                                                                                   |
| R16 | `c5c7332` | Un transform que devuelve un array lo rechazan los tipos de `mz.after`, pero no el runtime.                                                                                                                                                                                             |
| R17 | `7d3376e` | `mz.update` no acepta `$unset` de keys de un record o un catchall (lanza `is required`); el modelo sí.                                                                                                                                                                                  |
| R18 | `6b50a22` | El mensaje habla de un transform también con `.optional()` o una `z.union` en la raíz.                                                                                                                                                                                                  |
| R19 | `359714d` | El `IsAny` de `Entries` no tiene efecto: `{ name: 1, email: anyValue }` da `mixes inclusion and exclusion`.                                                                                                                                                                             |
| R20 | `0646c67` | El límite sube a 70.000/78.000 cuando el proyecto nuevo (65.532/73.379) entraba en el anterior (67.000/74.000).                                                                                                                                                                         |
| R21 | `392b4b1` | En [Modelo](../proposal/model.md) quedó la frase de `useBigInt64` «se chequea en la primera»; el `@example` de `mongozod()` usa `db: () => client.db()`, que arma un `Db` por operación, contra lo que aconseja el JSDoc de `db`; el changeset no dice qué cambia para quien ya la usa. |
| R22 | `2040236` | Los tipos no saben qué hooks escribe el plugin: uno con `fills` que no cubre `insertMany` compila ahí sin el campo y lanza `ZodError`. El doc no lista qué operaciones tiene que cubrir ni que un upsert necesita su `$setOnInsert`.                                                    |
| R23 | `783aa58` | El mensaje de `as const` sale para un `Record<string, number>`, donde no aplica, y un virtual en una variable dice `takes 0, 1, true or false` cuando el valor es `1`.                                                                                                                  |
| R24 | `d482ffe` | Agrega a [Inputs](../proposal/inputs.md) una sección «Comparar con un número» que es de otro cambio.                                                                                                                                                                                    |
| R25 | `2684ed7` | El editor sugiere paths con dos posicionales, como `items.$.tags.$`, que el servidor rechaza (18 de 79 sugerencias en un schema de 4 niveles); es un `feat` con changeset `patch`.                                                                                                      |
| R26 | `8041af2` | El doc y el changeset dicen que un campo fuera de la lista blanca de `mz.populate` da el mensaje nuevo; da `Unrecognized key`.                                                                                                                                                          |
| R27 | `2adb920` | Ningún test cuida que los `.d.ts` de `mongozod/mzod` no carguen `mongodb.d.ts`.                                                                                                                                                                                                         |
| R28 | `ae2877a` | El runtime acepta `author.$**` como peso y el servidor lo rechaza (código 67); el error de un peso inválido dice «index key».                                                                                                                                                           |

## Qué corregir

1. **R1**, antes de publicar: el narrowing es nuevo y su error pasa el compilador.
2. **Las dos regresiones, R2 y R3**, y los fixes incompletos **R4 a R10**, cada uno con un test que
   falle sin él.
3. **R11 y R12**, de proceso.
4. Las de severidad baja, cuando se toque su área.

## Ronda 2

Una segunda revisión de los 19 commits que corrigieron R1 a R28 (`a563825..68d967b`, en
`origin/main`), con el mismo método: los chequeos del repo, las reproducciones de la ronda 1 con
un tarball de `68d967b`, tres revisiones por área, y cada hallazgo de severidad alta o media
reproducido dos veces.

- **Los chequeos del repo pasan** desde la raíz y sin flags: 308 tests, `lint`, `format:check`,
  tipos, build, `check-dist-types` y `check-type-cost` (65.750 con TS 7 y 73.545 con 5.5). No quedan
  worktrees, ramas locales ni stash.
- **R1 a R10 pasan las reproducciones de la ronda 1**, pero cinco quedan a medias en variantes
  cercanas, y uno de ellos (R4) tiene un caso de severidad alta.
- **R16, R20 y R24 no tienen commit** ni una justificación escrita.

### Estado de cada hallazgo

La última columna dice qué commit resolvió cada hallazgo de esta ronda, o por qué no.

| Id  | Commit               | Estado          | Observaciones | Corrección de la ronda 2                                                                                                                                                |
| --- | -------------------- | --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `3ae9ca9`            | ✅              | S16           | S16: `e32a106`, el mensaje; aceptar el cambio dentro de la opción va a la fase 7                                                                                        |
| R2  | `d5f8325`            | 🟡 a medias     | S2            | S2: `47e1f78`                                                                                                                                                           |
| R3  | `bdaee6c`            | ✅              | S17           | S17: sin cambio, es la opción elegida y está anotada                                                                                                                    |
| R4  | `a846f33`            | 🟡 a medias     | S1, S9        | S1 y S9: `46d7693`                                                                                                                                                      |
| R5  | `c759d07`            | ✅              |               | —                                                                                                                                                                       |
| R6  | `ff122fc`            | ✅              | S18           | S18: refutado, `types.md` ya lo dice desde `2a639ef`: con punto no compila, porque MongoDB lo pone dentro del objeto                                                    |
| R7  | `0fb9d50`            | 🟡              | S8            | S8: `5efc7af`                                                                                                                                                           |
| R8  | `5798a07`            | ✅              | S10           | S10: `0a3cb50`, el doc y el changeset                                                                                                                                   |
| R9  | `d72b4ba`            | 🟡 a medias     | S4            | S4: `003d273`, en tipos y runtime                                                                                                                                       |
| R10 | `b9ece98`            | ✅              | S11           | S11: `3509c86`; la unión de un array y un objeto queda, anotada: el runtime es el lado seguro                                                                           |
| R11 | `64145f9`            | 🟡              | S14           | S14: `660fa70`                                                                                                                                                          |
| R12 | sin commit           | ✅              |               | —                                                                                                                                                                       |
| R13 | `34d581c`            | 🟡 a medias     | S5, S12       | S5: `c27707f`, el doc acotado; S12: subclases y `z.custom` en el mismo doc, `7ae1a1e` anuncia el rest de las tuplas, y el path de una tupla en un array queda (opinión) |
| R14 | `5798a07`            | ✅              |               | —                                                                                                                                                                       |
| R15 | `b0cdb70`            | 🟡 a medias     | S3, S13       | S3: `f57817a`; S13: `7763c64`                                                                                                                                           |
| R16 | —                    | ❌ sin resolver |               | Sin cambio: el runtime no ve la salida de un transform, y rechazar todos dejaría afuera `mz.date()`; anotado en `2451849`                                               |
| R17 | `68d967b` (a fase 7) | 🟡 mal descrito | S7            | S7: `c1e81a4`, el runtime y la frase del roadmap; los tipos siguen en la fase 7                                                                                         |
| R18 | `9bed7b2`            | ✅              | S12           | S12: `2a3e6f2` nombra `z.templateLiteral()`; `z.union()` y `z.lazy()` quedan                                                                                            |
| R19 | `c759d07`            | ✅              |               | —                                                                                                                                                                       |
| R20 | —                    | ❌ sin resolver |               | Refutado: el límite es lo medido más un 7 %, la regla de `structure.md`, y `0646c67` sumó los `.map()` al proyecto                                                      |
| R21 | `64145f9`            | ✅              |               | —                                                                                                                                                                       |
| R22 | `64145f9`            | ✅              |               | —                                                                                                                                                                       |
| R23 | `0fb9d50`            | 🟡              | S15           | S15: `62cfa90`                                                                                                                                                          |
| R24 | —                    | ❌ sin resolver |               | Refutado: la sección es la otra mitad de la decisión de F18, «los filtros no comparan un decimal con un `number`»                                                       |
| R25 | `1539bd3`, `1e69e67` | 🟡              | S6            | S6: `7a94d39`                                                                                                                                                           |
| R26 | `64145f9`            | ✅              |               | —                                                                                                                                                                       |
| R27 | `eb08be8`            | 🟡              | S14           | S14: `6ce33e0`                                                                                                                                                          |
| R28 | `8dc98a5`            | ✅              |               | —                                                                                                                                                                       |

### Alta

**S1. Un cursor con `populate` mezcla datos de dos bases** (`a846f33`, R4). El fix ata la consulta
principal al `Db` del momento en que se crea el cursor, pero las lecturas de `populate` resuelven la
función de `db` cuando se recorre. Un cursor creado en el contexto de un tenant y leído afuera
devuelve los documentos del tenant con los referenciados de la base por defecto, sin error; dentro
de una transacción pasa lo mismo.

```ts
const db = () => client.db(`app_${als.getStore() ?? 'default'}`)
const cursor = als.run('t', () => Posts.find({}, { populate: { author: true } }))
await cursor.toArray()
// [{ title: 'tenant', author: { name: 'default-user' } }]
```

El doc lo da por decidido («las lecturas de populate a otro modelo resuelven la base cuando
corren»), sin decir que eso mezcla tenants. **Corrección**: que el `populate` de un cursor use el
`Db` que resolvió el cursor para cada modelo, o que corra en el contexto asíncrono de su creación
(`AsyncLocalStorage.snapshot()`).

### Media

| Id  | R   | Hallazgo                                                                                                                                                                                                                                                                                 | Corrección                                                                                                                          |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S2  | R2  | El default de `Fills` en la interfaz `Plugin` sigue siendo todos sus `fields`: una factory anotada `Plugin<'tenant', { tenantId: z.ZodString }>`, sin `fills`, deja `tenantId` opcional; el insert compila sin él y lanza `ZodError`. `Plugin[]` sí quedó bien.                          | El default de `Fills` en `Plugin` es `readonly []`, como en `definePlugin`.                                                         |
| S3  | R15 | **Regresión.** Con `{ refs: { $elemMatch: { w: 2 } } }` en el populate de un `foreignField` dentro de un array (`refs.author`), se pierden documentos sin error: `u1` recibe `[]`. Antes MongoDB fallaba con `Path collision` (31249).                                                   | Cuando la proyección recorta el array del `foreignField` (`$elemMatch`, `$slice`), pedirlo entero y quitarlo después, o rechazarlo. |
| S4  | R9  | El `_id` entero en `$setOnInsert` compila y pasa la validación, pero el servidor lo rechaza (66) si el filtro fija otro `_id` o una parte (`{ '_id.shop': 's2' }`), aunque el valor coincida. El doc da a entender que el `_id` entero lo resuelve.                                      | Rechazar el `_id` en `$setOnInsert` cuando el filtro ya fija el `_id` o una parte, o decirlo en el doc.                             |
| S5  | R13 | `z.instanceof(Set)` solo se rechaza tal cual: con `.refine()`, `.describe()`, `.meta()` o `.check()` se acepta y guarda `{}`. El chequeo lee `_zod.bag.Class`, que es interno de Zod y no pasa a los clones. El doc promete cualquier `z.instanceof()`.                                  | Reconocerlo por algo que se conserve en los clones, o acotar el doc.                                                                |
| S6  | R25 | Dos `$` siguen compilando y pasando la validación: `$set: { 'items.$.tags.$': 'z' }` y MongoDB lo rechaza siempre (código 2). Ya no se sugieren, pero el doc no decide si compilan.                                                                                                      | Rechazarlos en `Next` (`types/update.ts`) y en `resolveUpdatePath`, como dos `$` en una proyección.                                 |
| S7  | R17 | El roadmap dice que el runtime acepta los paths que `mz.update` no tipa, y no es así: `mz.update(schema, { $unset: ['dyn.k'] })` sigue lanzando `"dyn.k" is required, so it cannot be unset`, que era R17. Además la frase quedó metida en medio de una enumeración.                     | Corregir el runtime de `mz.update` (el modelo ya lo acepta) o la frase, y sacarla de la enumeración.                                |
| S8  | R7  | `{ meta: {} }` vuelve a compilar y MongoDB la rechaza (`Invalid empty sub-projection`, 51270). Es una decisión anotada en `types.md`, pero su razón (las sugerencias) no se sostiene: dentro de `{ meta: { \| } }` el editor no sugiere nada de todas formas. El commit no agrega tests. | Rechazar `{}` con su propio mensaje (`"meta" takes a field inside`), como pedía R7.                                                 |

### Baja

| Id  | R        | Hallazgo                                                                                                                                                                                                                                                                                                                       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S9  | R4       | Si la función de `db` lanza, `find()` y `aggregate()` ahora lanzan al crear el cursor, de forma sincrónica (`findOne` rechaza la promesa): un `.toArray().catch()` ya no lo atrapa. No se anuncia.                                                                                                                             |
| S10 | R8       | Un `Decimal128` NaN ya guardado se lee, pero `replaceOne` con lo leído y `z.encode` dan `ZodError`; el changeset es `patch` y no lo anuncia. El servidor todavía produce `Infinity` por overflow (`$mul` sobre `1e6144`).                                                                                                      |
| S11 | R10      | `$rename` desde o hacia un elemento de un array (`items.0.name`) compila y pasa la validación; el servidor lo rechaza (código 2). En una unión array \| objeto, `$unset: { 'u.0': '' }` compila y el runtime lo rechaza.                                                                                                       |
| S12 | R13, R18 | Las subclases (`z.instanceof(MySet)`) y `z.custom<Set>` pasan; una tupla dentro de un array da un path ambiguo (`t.1.s`). Los mensajes de la raíz nombran `z.template_literal()`, `z.union()` para `mz.objectId()` y `z.lazy()` para `z.json()`.                                                                               |
| S13 | R15      | Con un `foreignField` dentro de un array de objetos, una inclusión deja `refs: [{}, {}]`, que el tipo no tiene.                                                                                                                                                                                                                |
| S14 | R11, R27 | La nota de F6 en `types.md` remite a la guía «Desde Mongoose», que todavía no existe, y cita «unas 200.000» instanciaciones y un rango de 100.000 a 270.000 que no salen de ninguna medición registrada (C2 midió 254k). El test de `mongozod/mzod` no ve `import('mongodb')`, `/// <reference types>` ni las comillas dobles. |
| S15 | R23      | Con un `Record<string, number>`, el mensaje aconseja tiparlo `0 \| 1`, y `Record<string, 0 \| 1>` da `"${string}" is not a path of the document`: solo compila como `Document`.                                                                                                                                                |
| S16 | R1       | Con un discriminador `z.enum`, `updateOne({ type: 'view' }, { $set: { type: 'impression' } })` se rechaza (`changes the type of its object`), aunque no cambia de tipo. El doc no lo dice.                                                                                                                                     |
| S17 | R3       | `index({})` ahora compila (se rechaza solo en runtime). Es la opción elegida y está anotada.                                                                                                                                                                                                                                   |
| S18 | R6       | Los tipos rechazan `{ 'meta.by': { $meta: 'textScore' } }`, que MongoDB 8.2 acepta; ningún doc lo dice.                                                                                                                                                                                                                        |

### Qué corregir

1. **S1**, antes de publicar: mezcla datos de tenants sin error.
2. **S2 a S7**, cada uno con un test que falle sin él; S3 es una regresión.
3. **S8**, y decidir R16, R20 y R24, o escribir por qué quedan.
4. Las de severidad baja, cuando se toque su área.
5. Commitear este informe, con la tabla de estado.
