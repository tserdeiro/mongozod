# Fricciones de la migración de adsgpt

adsgpt migró de `MongoModel`, `MongoSchema`, el `parser` y los helpers de Zod del package `libs` a
mongozod 0.3.3, en el stack wortise/adsgpt#511 a wortise/adsgpt#516. El agente que hizo la
migración anotó 27 fricciones, cada una con una idea de solución. Este documento las verifica una
por una y propone cómo resolver cada una, con un PR por solución.

Las ideas de las notas no se toman al pie de la letra: cada propuesta sale de reproducir el
problema, encontrar su causa y comparar alternativas. Las que agregan API se miden contra las
reglas de [AGENTS.md](../../AGENTS.md): la API de MongoDB y de Zod antes que props propias, y nada
de sobreingeniería. Las marcadas como **Decisión** se acordaron con el maintainer el 2026-10-21; los
detalles que quedan abiertos se deciden en el PR de cada una.

## Método

- **Versión**: mongozod 0.3.3, que es `main` y la que usa adsgpt.
- **adsgpt**: la rama `chore/mongozod-cleanup`, la última del stack, y `dev` para el código de
  antes.
- **Los otros dos proyectos que usaban `MongoModel`**: wortise-dashboard-monorepo y app-maker,
  como referencia de cuánto se repite cada patrón.
- **Tipos**: cada caso se reprodujo con un probe compilado con TypeScript 7.0.2 y 5.5.4, contra
  `src`. Los costos son instanciaciones de `--extendedDiagnostics`, y las sugerencias salen del
  LanguageService de TS 5.5.
- **Runtime**: contra MongoDB 8.2 (`mongodb-memory-server`) con el driver 7.7.0.
- **Bundle**: rolldown 1.2.13 con minify y tree shaking sobre el `dist/` publicado.
- **Fuentes**: los manuales de MongoDB, Mongoose, Zod y Expo, citados en cada punto.

Los probes quedaron fuera del repo.

## Resumen

| #      | Fricción                                              | Diagnóstico                                     | Solución                                                       | PR     |
| ------ | ----------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ------ |
| 1      | Sin helper de búsqueda                                | Por diseño; ningún helper escapa el término     | Constructor en `mongozod/mzod` que escapa y pliega acentos     | 15     |
| 2      | `sync()` sin camino para el deploy                    | Por diseño, a prueba                            | Docs: cuándo correrlo, y un plugin opt-in que crea los índices | 18     |
| 3      | `mz.projection` tipa todo opcional                    | Por diseño; la doc de `.optional()` quedó vieja | Docs: proyección fija por endpoint, y corregir `.optional()`   | 19     |
| 4      | `mz.sort` en un helper genérico de paginación         | Límite de TypeScript con los tipos de Zod       | Docs: el schema de página compartido con `.extend()`           | 20     |
| 5      | `updatedAt` también al insertar                       | Por diseño, como Mongoose                       | Se mantiene; docs: «editado alguna vez»                        | 21     |
| 6      | Borrado real con `softDelete`                         | Por diseño: solo filtros                        | Docs: el filtro de MongoDB para borrar de verdad               | 17     |
| 7 y 20 | `undefined` en los filtros                            | Por diseño; el error no dice qué hacer          | Se sigue rechazando; mensaje con la solución                   | 7      |
| 8      | Sin tipo para las opciones de lectura de un service   | Hueco                                           | `FindOptionsOf<M>`                                             | 8      |
| 9      | `mongozod/mzod` trae `bson` en React Native           | Metro no hace tree shaking; la doc dice que sí  | Docs: corregir y agregar React Native                          | 22     |
| 10     | `ReadOf` con la salida de `mz.populate`               | **Bug**, corregido                              | Corregir `PopulateOf` y `ProjectionOf`                         | 2      |
| 11     | Un service que a veces puebla tipa siempre la unión   | Límite de la inferencia                         | Docs: un método por caso                                       | 8      |
| 12     | `$unset` armado en una variable                       | Ensanchamiento de TS                            | Mensaje que nombra la causa, y docs                            | 13     |
| 13     | Un modelo que referencia a otro lo importa            | Docs                                            | Una línea en Populate                                          | 23     |
| 14     | Genéricos `const` en cada método del service          | Por diseño; **caro en tipos**                   | Tipos de método; medir y bajar el costo                        | 11, 12 |
| 15     | Las opciones de cada lista en un tipo por módulo      | Hueco                                           | `FindOptionsOf<M>`                                             | 8      |
| 16     | Sin tipo para las operaciones de `bulkWrite`          | Hueco                                           | Exportar `BulkWriteOf`                                         | 9      |
| 17     | `$set` de un `z.unknown()`                            | **Bug**, corregido                              | `Loose` deja pasar `unknown`                                   | 5      |
| 18     | `mz.filter` con `$eq` no deja leer el valor           | Por diseño; `[]` compila sin servir             | `[]` en `mz.filter` como «el valor»                            | 14     |
| 19     | Un input que se convierte antes de guardarse          | Por diseño                                      | Docs: codecs con `.extend()` y el patrón del comando           | 19     |
| 21     | Las keys de un record por `enum` no son paths         | **Bug**, corregido                              | Comparar el segmento con el template del enum                  | 4      |
| 22     | `timestamps: { updatedAt: false }` pide `createdAt`   | **Bug**, corregido                              | Corregir `FieldName`                                           | 3      |
| 23     | `softDelete` también filtra los updates               | Por diseño, sin guía de migración               | Sin cambios: es del patrón propio, no de Mongoose              | —      |
| 24     | Los campos de `timestamps` sin `.default()`           | Por diseño; el `.default()` ya funciona         | Docs: cuándo poner `.default()`                                | 21     |
| 25     | `arrayFilters` obliga a otro método                   | Hueco, y el método aparte pierde chequeos       | Exportar `UpdateOptionsOf`                                     | 10     |
| 26     | Sin equivalente de `parser.update`                    | Hueco: la propuesta no trata el servidor        | Sin helper ni sección: `$set` o `$unset`, como el driver       | 16     |
| 27     | Detalles: sort en una constante, resultados, conexión | Ensanchamiento de TS; docs                      | Mensaje del sort; docs de resultados y conexión                | 13, 23 |

Los números de PR son los del [stack](#stack-de-prs).

## Hallazgos que no estaban en las notas

- **`findOneAndUpdate` con un `populate` que puede faltar tipa el documento sin poblar** (con la
  misma causa que la 10), y con `exactOptionalPropertyTypes` directamente no compila, aunque la
  guía de TypeScript dice que `populate`, `projection` y `sort` aceptan `undefined`.
- **`ReadOf` con una `projection` opcional da el documento entero**, mientras `find` con las mismas
  opciones da cada campo opcional.
- **`mz.sort` tipa su entrada como `unknown`** (`src/mzod/sort.ts:26`): el cliente de tRPC ve
  `sort?: unknown` y no sabe qué orden acepta cada lista. Los demás constructores declaran su
  entrada. Por eso el `as const` de los tests de adsgpt no hacía falta.
- **El patrón documentado para services es caro.** Un `updateOne` del service que reenvía con
  `UpdateOf` a `findOneAndUpdate(…, { returnDocument: 'after' })` cuesta unas 91.500
  instanciaciones con TS 7 y 95.100 con TS 5.5, más que el presupuesto entero del proyecto típico
  (70.000 y 78.000). Con las opciones en una constante, cuesta 8.900 y 4.100. El proyecto de
  `check-type-cost` no tiene services, así que no lo mide.
- **El método aparte con `arrayFilters: Document[]` apaga el chequeo de sus entradas**: un
  identificador mal escrito compila.
- **Un `.default({})` encima de `mz.projection` saltea la lista blanca**: Zod devuelve `{}` sin
  parsear y MongoDB devuelve el documento entero. Y la doc de `.optional()` quedó vieja: desde Zod
  4.5 (colinhacks/zod#6419), un `.optional()` corre el default de adentro, así que devuelve la
  máscara y no `undefined`.
- **Cuatro frases de la doc son falsas para Metro**: dicen que un bundler deja afuera `bson` y lo
  que no se usa con `import * as mz`.
- **El ejemplo `timestamps: { createdAt: 'created_at' }` del cheatsheet de Mongoose cae en el bug 22.**
- **Ningún helper de búsqueda de los tres proyectos escapa el término**: un `[` es un 500 y un
  patrón como `(a+)+$` es un ReDoS (ver la 1).
- **El error de un `undefined` en un filtro explica mal el riesgo con `ignoreUndefined`**, que
  adsgpt usa: ahí el driver quita la key en vez de mandar `null`.
- **`mz.filter(schema, { _id: [] })` compila y no acepta ningún valor.**
- **`.pick({ _id: true }).required()` convierte el `{ _id: undefined }` que manda superjson en un id
  nuevo**, y `removeDefault()` está deprecado en Zod 4 en favor de `.unwrap()`.

## Análisis

### Tipos de los services: 8, 10, 11, 14, 15, 16 y 25

#### 10. `ReadOf` con la salida de `mz.populate` (bug)

`ReadOf<M, { populate?: z.output<typeof populate> }>` da el documento sin poblar, y `findOne` con
las mismas opciones da la unión poblada. Son dos causas:

- `PopulateOf<O> = O extends { populate: infer Pop } ? Pop : None` (`src/model/model.ts:138`): una
  key opcional no extiende una requerida, así que da `None`. `ProjectionOf` (`:136`) tiene el mismo
  problema.
- La salida de `mz.populate` es `X | undefined`, porque el constructor es `.optional()`, y
  `Populated` pregunta por `keyof Pop`, que es `never` para una unión con `undefined`.

La operación no tiene el problema porque infiere `Pop` del argumento y la inferencia quita el
`undefined`. `findOneAndUpdate` usa el mismo `PopulateOf`, así que tiene el bug.

**Decisión**: `O extends { populate?: infer Pop } ? Exclude<Pop, undefined> : None`, lo mismo en
`ProjectionOf`, y `| undefined` en `populate`, `projection` y `sort` de las opciones de los updates.
Prototipado: pasan las igualdades con la operación en TS 7 y 5.5, con la key opcional y con
`X | undefined`, y sin cambios en los casos de hoy. Un test de tipos fija `ReadOf` igual a la
operación con la salida de `mz.populate`.

#### 8 y 15. Las opciones de lectura de un service

`ReadOptionsArg` es la tupla de opciones de `countDocuments` con el `context` de los plugins: no
tiene `sort`, `projection` ni `populate`. adsgpt tiene 15 tipos de opciones (11 `*ListOptions` y 4
`*ReadOptions`) armados con `Pick` de la salida de los inputs, con variaciones sin razón: `limit` y
`skip` requeridos en 6 y opcionales en 5. Tres listas además ordenan por un campo que solo usa el
servidor, como el `nextRunAt` del scheduler. wortise y app-maker tenían un alias por módulo del
`QueryOptions` del driver.

**Decisión**: exportar `FindOptionsOf<M>`, un tipo no genérico, como `InsertOf`, con `limit`,
`skip`, `sort` y `populate` tipados contra el modelo. Prototipado: el router le pasa
`input.populate` e `input.sort` sin adaptar nada, el servidor ordena por `{ nextRunAt: 1 }` sin
extender el tipo, y el editor sugiere los 8 paths del sort (hoy, 3). Cuesta lo mismo que el
`Pick` de hoy (+19.700 contra +18.800 con TS 7).

- **Sin `projection`**: una proyección no literal deja opcional cada campo del resultado (ver la 3).
- **Límites**: los errores son los de TypeScript y no los de mongozod; no toma paths de más de 6
  niveles ni un sort por `$meta`; no lleva el `context` de los plugins.

**Descartado**: sumar `sort`, `populate` y lo demás a `ReadOptionsArg`, que cambiaría lo que
significa; y una restricción genérica `ReadOptionsOf<M, O>`, que choca con el dilema de la 11.

#### 11. Un service que a veces puebla

`find` y `findOne` toman `Sort`, `P` y `Pop` como parámetros de tipo separados. Dentro de un
service genérico, la llamada al modelo se infiere una sola vez desde la restricción, así que el
resultado del service no sigue a su genérico. No es un bug. Con `MongoModel` pasaba lo mismo: el
scheduler ya acotaba `typeof routine.organization === 'string'`.

**Decisión**: documentar en Repositories un método por caso. El que llama el servidor no toma
`populate` y devuelve el documento; el que llama el router toma `FindOptionsOf` y devuelve la
unión.

**Descartado**:

- **Overloads genéricos en el service**: funcionan y conservan las sugerencias, pero el compilador
  no verifica que el cuerpo devuelva lo que declaran, y los services de objeto literal pasarían a
  funciones declaradas.
- **Que `find` y `findOne` tomen un único `const O`**, como `findOneAndUpdate`: con el default
  `= {}` el editor deja de sugerir, sin él la llamada sin opciones vuelve a la unión, y con las
  sugerencias en el parámetro cuesta +146.000.

#### 14. Los genéricos `const` en cada método

adsgpt tiene 54 métodos con `const F extends FilterOf` en 17 services, y 16 con `UpdateOf`. Es el
patrón documentado, y cualquier alternativa sin genérico pierde el chequeo por key, que necesita el
tipo literal del argumento. Lo verificado:

- **El `const` importa sobre todo en las opciones**: sin él, `arrayFilters` deja de ser una tupla y
  `upsert: true` pasa a `boolean`, y se pierden sus chequeos. En el filtro y el update, el tipo
  contextual conserva los literales en los casos probados.
- **Un tipo de método con `satisfies`** funciona y cuesta lo mismo, pero repite la lista de métodos
  y hace aparecer un genérico que no está escrito.
- **El costo**: ver [Hallazgos](#hallazgos-que-no-estaban-en-las-notas). Lo paga
  `getVariancesWorker` sobre `UpdateCheck`, cuando el `U` del service se compara con la restricción
  del modelo con otro `O`.

**Decisión**: un PR que primero sume un service al proyecto de `check-type-cost`, después intente
bajar el costo (por ejemplo, que `UpdateCheck` dependa solo de `arrayFilters`, `upsert`,
`timestamps` y `updatePipeline`) y, si no se puede, documente las opciones en una constante. La guía
explica por qué va el `const`.

Además, para no repetir los genéricos en cada método, el maintainer pidió una forma más corta sin
perder seguridad de tipos. Se descartó un `Filter<M>` no genérico, como el del driver, que no puede
chequear cada key, y se exportan tipos de método que se dan con `satisfies` (PR 11):
`FilterMethod`, `UpdateMethod`, `ReplaceMethod`, `BulkWriteMethod`, `AggregateMethod` y
`DistinctMethod`, más `PipelineOf`. Conservan los chequeos, las sugerencias y el costo, y sirven
para objetos, funciones sueltas y propiedades flecha de clases; el resto escribe los genéricos.

#### 16. `bulkWrite` desde un service

`BulkWriteCheck` está exportado en `src/model/model.ts:239` pero no en `src/index.ts`. Un service
con `AnyBulkWriteOperation<…>[]` no compila contra el modelo.

**Decisión**: exportar `BulkWriteOf<M, Ops>`, simétrico con `UpdateOf`. Prototipado: mismos
mensajes que el modelo, +4.900 y +1.100. wortise también arma `bulkWrite` en sus services.

#### 25. `arrayFilters` y las opciones genéricas

`UpdateOf` necesita conocer las opciones, porque un `$[id]` pide `arrayFilters`. Lo verificado:

- Una opción `arrayFilters?:` opcional da «pass arrayFilters», porque `ArrayFiltersOf` pide la key
  presente.
- El `ModifyResultOf` de la tabla de las notas no se infiere de `O`: es la recuperación de errores
  de TypeScript, que muestra el primer overload cuando ninguno aplica.
- El método aparte que dejó adsgpt (`updateElements`, 12 llamadas) apaga el chequeo de las entradas
  de `arrayFilters`.

**Decisión**: exportar `UpdateOptionsOf<M, U, O>`, la restricción que el modelo ya usa. Un solo
`updateOne(filter, update, options?)` del service toma `const O extends UpdateOptionsOf<M, U, O>` y
la pasa tal cual, con todos los mensajes del modelo. Cuesta lo mismo que el método aparte de hoy
(+79.000 contra +81.000), y el costo es el de la 14. Con `findOneAndUpdate`, la restricción suma
`includeResultMetadata?: false` para devolver el documento.

### Paths y literales: 12, 17, 21 y 27 (sort)

#### 21. Records con keys de un `enum` (bug)

Falla con un `enum` de TypeScript como schema de keys (`z.enum(Channel)`), no con `z.enum([…])`, y
en todo lo que resuelve paths: filtros, updates, proyecciones, sorts, `distinct` y los
constructores de `mz`. La causa está en `src/schema/schema-at.ts:133`, `Seg extends
core.output<K>`: un literal `'chat'` no es asignable a un enum de strings, pero sí a
`` `${Channel}` ``. El runtime parsea el segmento con el schema de keys, así que acepta el valor.

**Decisión**: `Seg extends \`${core.output<K> & string}\``. Prototipado: +20 instanciaciones y
sigue rechazando una key que no está en el enum. La línea de adsgpt además necesita sus keys
calculadas armadas aparte, porque TypeScript ensancha una key calculada que no es un único literal
(microsoft/TypeScript#13948); «Computed keys» suma el ejemplo con un enum.

#### 17. `$set` de un `z.unknown()` (bug)

`Loose` (`src/types/loose.ts:19`) convierte `unknown` en el mapped type `{}`. Falla en `$set`, en
un path debajo del campo, en un `z.record(z.string(), z.unknown())` y en `$push` a un
`z.unknown().array()`. Contradice [Tipos](../proposal/types.md), que dice que `$set` toma el
`z.input`, que acá es `unknown`. El runtime acepta `null`.

**Decisión**: `unknown extends V ? V : …` al principio de `Loose`. Prototipado: baja el costo
(−57 y −388). wortise tiene 7 campos así y app-maker 4.

#### 12 y 27 (sort). Literales ensanchados

`const update = { $unset: { nextRunAt: '' } }` ensancha `''` a `string`, y lo mismo pasa con `1` y
`true` en `$unset`, `$currentDate`, `$pop` y los sorts. Es el ensanchamiento normal de TypeScript y
el driver tipa igual; la diferencia es que el driver lo dejaba pasar porque intersecta con
`Document`. MongoDB ignora el valor de `$unset`, incluso `false`.

**Decisión**: un mensaje para el valor ensanchado, como el que ya tiene la proyección, por
ejemplo `"nextRunAt" is a string: $unset takes '', 1 or true, so declare the update with as const`,
y la línea en la guía de TypeScript. Prototipado: +71 en los updates y +197 en el sort con TS 7
(TS 5.5 no lo muestra en `.sort()` ni en `SortOf`).

**Descartado**: aceptar `string` en `$unset`, que no cuesta nada pero deja `$currentDate` y `$pop`
igual y aleja el modelo de `mz.update`; y aceptar `number` en el sort, que pasaría el error al
driver.

### Timestamps: 5, 22 y 24

#### 22. Un objeto de `timestamps` con una sola key (bug)

`FieldName` (`src/model/timestamps.ts:21`) pregunta `T extends { [P in K]?: infer V }`, un tipo
débil: un objeto que no comparte ninguna propiedad con él no se le asigna, así que cae en `never`.
Rompe `{ updatedAt: false }`, `{ createdAt: false }`, `{ createdAt: 'created' }` y
`{ createdAt: true }`, en tres lugares: los inserts piden el campo, el chequeo del schema no ve que
falta y el update deja escribirlo (el runtime lo rechaza).

**Decisión**: preguntar por la key con `keyof`. Prototipado: la matriz completa compila en TS 7 y
5.5, +70 instanciaciones.

#### 5. `updatedAt` al insertar

Es una decisión registrada en [El modelo](../proposal/model.md#inserts-y-reemplazos), tomada
sabiendo que los tres `MongoModel` no lo escribían, y coincide con Mongoose, que tampoco tiene una
opción de schema para evitarlo. «Sin `updatedAt` = nunca editado» solo aparece en las notas de
adsgpt.

Escribirlo solo en los updates, como los `MongoModel`, se evaluó con el maintainer y se descartó:

- **`updatedAt` pasaría a ser opcional en el schema**, un cambio que rompe a quien lo declara
  obligatorio.
- **Un upsert que inserta lo escribiría igual**, porque MongoDB le aplica el `$set`.
- **Un sort por `updatedAt` desc dejaría al final los documentos nunca editados.**
- **Se apartaría de Mongoose, de Rails** («whenever the record is created or updated») **y del
  `auto_now` de Django**, que actúa en cada `save()`, incluido el primero.

**Decisión**: se mantiene, con una receta en Timestamps para «editado alguna vez», con dos formas:

- **Si alcanza filtrar después de un índice**: `$expr: { $gt: ['$updatedAt', '$createdAt'] }`
  junto a una igualdad indexada. Comparar dos campos con `$expr` no usa índices, pero con el índice
  de la organización el explain muestra `IXSCAN` y filtra solo sus documentos. `$ne` cuenta mal los
  documentos viejos sin `updatedAt`.
- **Si hace falta indexarlo**: un campo de dominio, como `editedAt`, que escribe el update.

**Descartado**: una opción `updatedAt: { onInsert: false }`, que no existe en Mongoose y que un
upsert no puede cumplir, porque el `$set` también se aplica al documento insertado.

#### 24. Parsear el schema fuera del modelo

Un `.default(() => new Date())` en los campos de `timestamps` ya funciona: el modelo pone su fecha
antes de validar, así que gana en todo lo que crea o reemplaza, y el default solo actúa fuera del
modelo o con `timestamps: false`. La propuesta lo dice («Un `.default()` sigue funcionando»), pero
la tabla del README y la guía lo presentan como «sin `.default()`». adsgpt agregó `createdAt` en 14
lugares (12 fixtures, un documento virtual y una validación previa). En wortise, 30 de 34
`createdAt` tienen el default.

**Decisión**: que la guía diga cuándo poner el `.default()`: cuando el schema también se parsea
fuera del modelo. Lo que cambia es que una operación con `timestamps: false` deja de pedir la fecha.

**Descartado**: un `insertSchema` del modelo. La API de Zod no lo arma en general: `.partial()` y
`.extend()` lanzan con refinements, y `z.discriminatedUnion` no los tiene.

### Inputs: 1, 3, 4, 7 y 20, 18, 19, 26 y 27 (keys extra)

#### 3. `mz.projection` tipa todo opcional

Por diseño: el endpoint no sabe al compilar qué va a pedir el cliente, y una salida de tRPC tiene un
solo tipo. Partir el router según la proyección tampoco ayuda: los dos tipos se reducen al
opcional. wortise manda proyecciones desde muchas tablas del dashboard, así que la fricción se va a
repetir ahí.

**Decisión**: documentar en Endpoint inputs que un endpoint con `mz.projection` devuelve campos
opcionales a todos sus clientes, y que una vista recortada va mejor como otro endpoint con una
proyección fija del servidor, que tipa exacto. En la misma sección, corregir `.optional()` y nombrar
`.default({})` como error común.

**Descartado**: `{ optional: true }` u overloads, que no cambian el tipo único de la salida del
endpoint.

#### 4. Paginación compartida con un `mz.sort` por lista

`.prefault({})` sobre un `z.object` cuyo shape tiene un parámetro de tipo no compila: Zod decide si
una key es opcional con un condicional sobre ese parámetro, y TypeScript no lo resuelve. No es de
mongozod. Dos formas compilan en TS 7 y 5.5 y conservan el contrato `pagination.sort`:

- **Sin genérico**: un `pageSchema = z.object({ limit, page })` compartido, y en cada lista
  `pagination: pageSchema.extend({ sort: mz.sort(…).default(…) }).prefault({})`. Tipa bien el
  default del sort.
- **Con genérico**: el helper envuelve el sort en `.optional()`. Pierde el tipo del default.

**Decisión** (con el maintainer): el input de una lista refleja la llamada del modelo,
`find(filter, options)`. Lo que elige los documentos (`filter`, `after`, `term`) va del lado del
filtro, y `options` lleva las opciones del driver: `limit` y `skip`, validados con números de Zod y
un `.max()`, y `sort`, `projection` y `populate` de `mz`. El router pasa `input.options` tal cual,
sin middleware ni `ctx.pagination`, y el cliente calcula el `skip` de una página
(`pageIndex * pageSize`). No hace falta un constructor: se descartó un `mz.page()` que convirtiera
el número de página, por las props propias y la ceremonia. El `cursor` de tRPC queda afuera: para el
scroll infinito, `mz.after`. Lo cubren los ejemplos de Pagination y de Endpoint inputs.

#### 19. Un input que se convierte antes de guardarse

Para una conversión campo por campo, como dinero en unidades a micros, alcanza con Zod: un
`z.codec` en un `.extend()` del schema que recibe `mz.update`. Prototipado: el cliente manda
`amount`, se guarda `amountMicros`, y `z.encode` hace el camino de vuelta para la respuesta. El
update de blueprints no entra ahí: depende de lo guardado, construye las operaciones de cada
plataforma con llamadas asíncronas y valida reglas cruzadas. Es un comando, y el patrón del router
está bien.

**Decisión**: una sección en Endpoint inputs con los dos casos: el codec y el comando
(`removeDefault()`, juntar con lo guardado, parsear el documento y escribir). El codec de dinero
también va en Dates and money.

**Descartado**: `{ input: … }` en `mz.update` o un `mz.patch`, que repiten lo que `.extend()` ya
expresa.

#### 27 (keys extra). Keys del filtro que no son campos

`edited` en notas y `pinned` en chats se pueden traducir dentro del input, con un `.transform()`
después del `.extend()` y `.prefault({})`. La salida es un filtro del modelo, y el cliente sigue
sin poder mandar `$expr`. Prototipado en TS 7, 5.5 y MongoDB.

**Decisión**: sin doc. Se agrega con `.extend()` y la traduce el router, como hoy: una sección con
`.transform()` y `.prefault({})` mostraba más ceremonia que el caso, y el maintainer pidió no hacer
que la librería parezca más compleja de lo que es.

#### 1. Búsqueda en varios campos

La propuesta decidió no tener búsqueda propia y recomendar `$text` o Atlas Search
([Inputs](../proposal/inputs.md)), y la guía de seguridad pide armar el regex en el servidor «from an
escaped term with a maximum length», sin mostrar cómo. Lo verificado:

- **Ninguno de los tres helpers escapa el término**: ni el `parser.search` de adsgpt y wortise
  (6 y 14 llamadas) ni el `searchFilter` nuevo de adsgpt. `Símbolos [x` hace fallar al servidor
  (51091, un 500), `.` encuentra todo y un patrón como `(a+)+$` es un ReDoS, como advierte OWASP.
- **Las clases de vocales viejas también matchean la coma**: `[a,á,à,ä,â]` tiene comas adentro.
- **`$regex` con `i` ignora mayúsculas, no acentos**, y no usa la collation, como dice el manual.
  `$text` ignora los dos por defecto, pero busca palabras completas.
- **Un helper genérico se puede tipar sin casts**, armando la cláusula con un mapped type, pero sin
  el schema el editor no sugiere los campos.

**Decisión**: un constructor en `mongozod/mzod` que toma el schema y los campos, sugiere solo los
paths de strings, escapa el término, pliega los acentos y devuelve `(term) => filter`. Se usa con
el patrón que la doc ya muestra: `term: z.string().max(100).optional().transform(…)`. Revierte la
decisión de no tener búsqueda propia, a cambio de cerrar un hueco de seguridad que tenían los tres
proyectos. Prototipado en TS 7, 5.5 y MongoDB.

Al implementarlo se deciden el nombre (`search` se confunde con el `$search` de Atlas) y qué
letras pliega: el parser viejo solo plegaba vocales, y un término con tilde no encuentra el texto
sin tilde si no se normaliza antes.

**Descartado**: una receta para copiar, que deja en cada proyecto un código sensible y sin
sugerencias de campos.

#### 7 y 20. `undefined` en los filtros

Por diseño y documentado: falla cerrado, porque `findOne({ email, resetToken: body.token })`
encontraba al usuario sin `resetToken`. El error de runtime ya nombra el path, pero tiene dos
problemas:

- **No dice qué hacer.**
- **Su explicación es falsa con `ignoreUndefined`**, que adsgpt usa: ahí el driver no manda `null`,
  quita la key y encuentra todo.

El mensaje de los tipos (`Type 'undefined' is not assignable to type 'Value<…>'`) tampoco explica
nada. El idioma documentado, `...(status && { status })`, además descarta `false`, `''` y `0`.

Ignorar la key, como `ignoreUndefined` o `parser.query`, se evaluó con el maintainer y se
descartó: un valor que falta pasaría a matchear todo, y un `deleteMany({ organization })` sin
organización borraría las de todas. En los filtros de los clientes `mz.filter` ya descarta los
`undefined`, y en adsgpt no queda ningún filtro armado a mano que los limpie: el idioma solo hace
falta en una condición opcional que arma el servidor.

**Decisión**: seguir rechazándola. El error dice «leave the key out, or write null or
`{ $exists: false }`» sin afirmar lo del `null`, se prueba un mensaje de texto en los tipos y la
doc muestra `...(x !== undefined && { x })`.

**Descartado**: un `mz.defined(obj)`. Se tipa bien, pero `defined({ _id: undefined })` devuelve el
primer documento: reintroduce el bug que el chequeo cierra, y el tipo no lo ve porque `{ _id?: … }`
es un filtro válido.

#### 18. Un filtro por id cuyo valor se lee

`mz.filter(schema, { _id: ['$eq'] })` acepta el valor o `{ $eq }`, como Mongo, y un
`.transform()` arregla la salida pero no la entrada que ven los clientes. adsgpt lo reemplazó por
`z.object({ _id: schema.shape._id.removeDefault() })` en 10 módulos y 23 usos. Lo verificado:

- **`removeDefault()` está deprecado en Zod 4**: se reemplaza por `.unwrap()`.
- **`schema.pick({ _id: true }).required()`** convierte un `{ _id: undefined }`, que superjson manda,
  en un id nuevo, en Zod 4.3, 4.4 y 4.6.
- **`mz.filter(schema, { _id: [] })` compila y no acepta nada**: rechaza el valor y `{}`.

**Decisión**: que `[]` signifique «el valor, sin operadores». `mz.filter(schema, { _id: [] })`
tipa `{ _id?: string }`, y con `.required()`, `{ _id: string }`, del lado del cliente también.
Reusa la lista blanca y el guard de `filterValue`, sin un constructor nuevo, y le da sentido a una
declaración que hoy compila sin servir. Falta prototiparlo.

**Descartado**: un constructor `mz.equals(schema, ['_id'])`, que funciona (+3.700) pero suma API
para lo mismo que `[]`; y solo documentar `z.object({ _id: schema.shape._id.unwrap() })`.

#### 26. Los updates que arma el servidor

`parser.update` convertía un objeto plano: `null` a `$unset`, `undefined` afuera, el resto a
`$set` y `_id` a `$setOnInsert`. `mz.update` reemplaza lo que manda el cliente, pero la propuesta no
trata lo que arma el servidor. En `dev` había 10 así (4 usaban `null`), y hoy quedan 3 pares
`$set`/`$unset` con condicionales. mongozod ya descarta las keys `undefined` de cada operador, y
MongoDB acepta operadores vacíos. Ni Zod ni MongoDB tienen un equivalente: un update con pipeline y
`$$REMOVE` funciona, pero sus valores no se validan.

El punto difícil es un campo `.nullish()`: `null` puede ser un valor para guardar o un borrado. El
formulario de marca de native manda `logo: null`, que antes era `$unset` y hoy guarda `null`.

**Decisión**: ni helper ni sección nueva. Un update del servidor elige `$set` o `$unset`, como en
el driver, y la guía Validation ya dice que una key `undefined` se descarta. MongoDB no recomienda
un patrón para armarlos, y `null` → `$unset` era una convención de `MongoModel`.

**Descartado** (los dos prototipados):

- **`toUpdate(data)` sin schema**, como el parser: `null` va a `$unset`. Un campo nullable
  obligatorio no podría guardar `null` por esta vía.
- **`patch(schema, data)` con schema**: `null` va a `$set` si el campo lo acepta y a `$unset` si
  no. Evita la ambigüedad, pero agrega una semántica propia.

### Servidor y plugins: 2, 6 y 23

#### 2. `sync()` en el deploy

La propuesta dice que `sync()` «está a prueba: si resulta repetitivo o fácil de olvidar, se
cambia». Lo que mostró adsgpt:

- La lista del script tiene los 18 modelos y no falta ninguno, pero nada lo verifica.
- **Ningún test llama a `sync()`**, y el de 50 upserts concurrentes de `tool-usages` depende de un
  índice único: pasa porque es el primero de su archivo y la colección todavía no existe. Con la
  colección creada y sin el índice, dejó entre 1 y 9 documentos en 5 rondas.
- El deploy no llega a la base desde CI, y la doc no dice cómo hacerlo en ese caso. Tampoco lo
  desaconseja al arrancar: `guides/sync.md` dice «when you deploy, from a script or when the app
  starts».

Lo que dicen las fuentes:

- `createIndexes` con un índice idéntico no hace nada (unos 3 comandos y 1 ms por modelo), y el
  servidor junta los builds idénticos concurrentes.
- Mongoose crea los índices al arrancar, sin esperarlos, y recomienda apagarlo en producción
  (#15803 propone apagarlo por defecto en la 10).

**Decisión**: una sección «When to run it» en Sync, y un plugin opt-in. La sección no se ata a una
plataforma (si nombra ejemplos, se verifican), y tiene cuatro patrones:

- **Un paso del deploy antes de que la versión nueva reciba tráfico**: el release command, el job
  previo o el paso de CI con acceso a la base que tenga la plataforma.
- **Al arrancar el proceso, antes de escuchar**, para un servidor de larga vida, con sus riesgos:
  un build grande atrasa el ready, y un unique que falla se repite en cada arranque.
- **En la primera operación, con el plugin**: para desarrollo, tests y plataformas serverless, que
  no tienen un arranque antes de escuchar. Cada instancia nueva paga un `createIndexes`, que no hace
  nada si los índices existen.
- **En el setup de los tests**, como el `await Model.init()` de Mongoose.

El plugin crea los índices en la primera operación de cada modelo, como hacía `MongoModel`, con
una promesa por `Db`: el prototipo mandó un solo `createIndexes` para 50 primeras operaciones
concurrentes, y uno por tenant. La primera operación espera el build. Al implementarlo se deciden:

- **El nombre y el subpath**, como los de `softDelete`.
- **Solo los índices**: el `$jsonSchema` usa `collMod`, que el usuario `readWrite` de la app no
  tiene.
- **Qué pasa si falla**: guardar la promesa rechazada hace fallar cada operación para siempre, y
  reintentar relanza el build en cada una.
- **Cómo llega a los índices del modelo**: el modelo no los expone, y `AnyModel`, lo que ve un
  plugin, no tipa `sync`.

**Descartado**:

- **`sync({ dryRun: true })`**, como `diffIndexes`: prototipado, pero adsgpt no llega a la base
  desde CI.
- **`syncAll(models)`**, que no evita olvidar un modelo.
- **Un registro global de modelos**, que se ensucia con los de los tests y los `db` por tenant.

#### 6. Borrado real con `softDelete`

El plugin no suma opciones ni métodos, por decisión: todo se expresa con filtros. adsgpt copió la
constante `withDeleted` de la doc en 6 services. wortise y app-maker tenían `hard`, y app-maker
además `includeDeleted`.

El plugin ya sigue la regla del `filter.deletedAt ??= { $exists: false }` de `MongoModel`: si el
filtro menciona `deletedAt`, no agrega nada, y además lo busca dentro de `$and`, `$or` y `$nor`. La
diferencia está en el borrado real: el `hard: true` de `MongoModel` llamaba directo a
`collection.deleteOne`. En MongoDB no hay un filtro más corto que el `$or` de los dos `$exists`
para decir «borrado o no».

**Decisión**: el filtro de MongoDB, sin exportar nada. La tabla de referencia de Soft delete suma
la fila «Delete a document for real, deleted or not»:
`deleteOne({ _id, $or: [{ deletedAt: { $exists: true } }, { deletedAt: { $exists: false } }] })`.
Pasa por el modelo, con su chequeo de `undefined` y los demás plugins.

**Descartado** (con el maintainer):

- **Exportar `withDeleted`**, que no es API de MongoDB ni de Mongoose.
- **`Model.collection.deleteOne()`**, que se saltea el modelo: con `ignoreUndefined`,
  `{ _id: undefined }` borra el primer documento, y no corren los demás plugins.
- **Opciones por operación** (`{ hard }`, `{ withDeleted }`), que son props propias, contradicen
  la decisión del plugin y suben un 2 % el costo de tipos.

#### 23. `softDelete` en los updates y los conteos

Por diseño y documentado, pero sin una lista de qué cambia al migrar. Lo que encontró adsgpt:

- Los conteos bajan.
- Los updates del scheduler sobre una rutina borrada no hacen nada.
- Un upsert por `_id` sobre un documento borrado falla con 11000. Tres inputs de cliente de adsgpt
  lo exponen.
- `populate` devuelve `null` para una marca borrada.

wortise tiene 18 `filter.deletedAt ??=`.

**Decisión**: sin cambios en la doc. Lo que cambia es respecto de nuestro `MongoModel`, que
filtraba solo `find`, `findOne` y `distinct`, no respecto de Mongoose, y la página de Soft delete ya
cubre lo genérico: cada operación que filtra, los upserts y los errores comunes. Lo que hay que
buscar al migrar wortise y app-maker queda en [Para los otros proyectos](#para-los-otros-proyectos).

### Bundle: 9

En un bundler con tree shaking, `mongozod/mzod` no trae `bson` si no se usa un tipo de campo BSON:
ningún constructor lo importa. Metro no hace tree shaking, y el de Expo es experimental, necesita
dos flags, solo corre en producción y lo desactiva `import * as mz`, que es el estilo que
recomienda la doc. Son unos 77 KB minificados y 22 KB en gzip en un bundle de 22 MB. El aviso de
`crypto.getRandomValues` sale al importar `bson`, no al generar un id.

**Decisión**: corregir las cuatro frases falsas y sumar una sección de React Native y Expo a
Installation o BSON types.

**Descartado por ahora**: un entry aparte para los tipos de campo BSON, `mongozod/mzod/bson`, que es
lo único que lo resuelve en Metro sin flags, pero rompe todos los usos de `mz.objectId()` y
revierte la decisión de [Inputs](../proposal/inputs.md) de tener todo en un lugar. Importar `bson`
de forma lazy vuelve asíncronos los codecs y rompe el `.parse()` síncrono.

### Lo que sirve a cualquier proyecto: 13, 20 y 27

Las notas piden una guía «Migrating from a custom wrapper», pero `MongoModel` es propio de estos
tres proyectos: quien llega a mongozod viene, en general, de Mongoose, que ya tiene su guía. Lo que
sirve a cualquiera va en la página de su tema:

- **`ignoreUndefined`** (Connection y TypeScript): con mongozod deja de hacer falta, porque el modelo
  descarta las keys `undefined` al escribir y las rechaza en los filtros; con él, el driver quita una
  key `undefined` de un filtro escrito con el driver y encuentra todo. Un tipo que esconde un
  `undefined`, como el `removeDefaults` de antes, aparece al migrar como un error nuevo (20).
- **El módulo de conexión** (Connection): el `db` de un modelo puede ser una función, y el driver
  conecta en la primera operación, así que no hace falta esperar a `connect()`.
- **El documento después de un update** (Operations): `updateOne` devuelve el `UpdateResult` del
  driver, y `findOneAndUpdate` con `returnDocument: 'after'`, el documento.
- **Las referencias entre modelos** (Populate): `() => Model` importa el módulo del otro modelo, así
  que conviene que los modelos no importen nada más, para evitar ciclos (13).

**Decisión**: secciones en las páginas de cada tema, sin una guía aparte.

## Stack de PRs

Cada PR sale del anterior y trae el código, los tests, la doc de usuario, la decisión en el
documento de la propuesta, la fila de este documento y su changeset cuando cambia el paquete.

| PR  | Título                                                                     | Fricciones        |
| --- | -------------------------------------------------------------------------- | ----------------- |
| 1   | `docs(audits): record the frictions of the adsgpt migration`               | Este documento    |
| 2   | `fix(mongozod): type reads whose populate or projection may be undefined`  | 10                |
| 3   | `fix(mongozod): default the timestamps fields an object leaves out`        | 22                |
| 4   | `fix(mongozod): resolve the paths of records keyed by a TypeScript enum`   | 21                |
| 5   | `fix(mongozod): take any value in updates of z.unknown() fields`           | 17                |
| 6   | `fix(mongozod): type the input of mz.sort`                                 | Hallazgo, hecho   |
| 7   | `fix(mongozod): say how to fix an undefined value in a filter`             | 7 y 20, hecho     |
| 8   | `feat(mongozod): export FindOptionsOf`                                     | 8, 11 y 15, hecho |
| 9   | `feat(mongozod): export BulkWriteOf`                                       | 16, hecho         |
| 10  | `feat(mongozod): export UpdateOptionsOf`                                   | 25, hecho         |
| 11  | `feat(mongozod): export method types for services`                         | 14, hecho         |
| 12  | `perf(mongozod): lower the cost of services that forward updates`          | 14, hecho         |
| 13  | `feat(mongozod): name the widened literals of updates and sorts`           | 12 y 27, hecho    |
| 14  | `feat(mongozod): take a field without operators in mz.filter as a value`   | 18, hecho         |
| 15  | `feat(mongozod): add mz.term for a search box`                             | 1, hecho          |
| 16  | `docs(proposal): record why server updates have no helper`                 | 26, hecho         |
| 17  | `docs(docs): delete a document for real with softDelete`                   | 6, hecho          |
| 18  | `feat(mongozod): create the indexes on the first operation, opt-in`        | 2, hecho          |
| 19  | `docs(docs): projections and inputs that convert`                          | 3, 19 y 27, hecho |
| 20  | `docs(docs): take the options of a list as the driver's`                   | 4, hecho          |
| 21  | `docs(docs): timestamps outside the model and edits`                       | 5 y 24            |
| 22  | `docs(docs): bson in React Native`                                         | 9                 |
| 23  | `docs(docs): ignoreUndefined, the connection and references across models` | 13, 20 y 27       |

Los arreglos van primero porque son chicos e independientes, y los tipos nuevos de los services
antes que las docs que los usan. La 23 no lleva PR (ver [su análisis](#23-softdelete-en-los-updates-y-los-conteos)).

## Para adsgpt

Lo que no es de mongozod pero apareció al verificar:

- **`searchFilter`** (`packages/libs/src/mongodb/search-filter.ts`) no escapa el término, y sus
  clases de vocales matchean la coma. Se arregla con lo que se decida en el PR 15.
- **El test de `tool-usages`** necesita `sync()` en su setup, o pasa por casualidad.
- **El `MongoClient` sigue con `ignoreUndefined: true`** (`packages/libs/src/mongodb/db.ts`).
- **Los upserts por `_id` que mandan los clientes** de brands, products y blueprints fallan con
  11000 sobre un documento borrado.
- **El `as const` del sort** de `messages/router.test.ts` no hace falta hoy, y sí después del PR 6.
- **Un comentario de `use-table.ts`** todavía habla de `pagination.sort`.
- **Si se vuelve al contrato `pagination.sort`** con el patrón del PR 21, los clientes no cambian.

## Para los otros proyectos

Al migrar wortise-dashboard-monorepo y app-maker, su `MongoModel` filtra los borrados en menos
operaciones que `softDelete`. Conviene buscar en el código:

- **Los `filter.deletedAt ??= { $exists: false }`** antes de un conteo o un update (wortise tiene
  18): sobran, porque el plugin filtra todas las operaciones con filtro.
- **Los updates que pueden tocar un documento borrado**, como los de un scheduler: dejan de
  matchear, sin error.
- **Los upserts por `_id`**, que sobre un documento borrado fallan con 11000 en vez de reactivarlo.
- **Los `hard: true` y los `includeDeleted`** (app-maker): pasan a un filtro que menciona
  `deletedAt`.
- **Los `populate` hacia un modelo con soft delete**, que devuelven `null` para un borrado, y los
  `aggregate` y `$lookup`, que siguen viéndolos.

## Próximos pasos

- **Una API de los constructores más cercana a Zod** (pedido del maintainer al revisar `mz.term`):
  algo como `mz.term(noteSchema.pick({ … })).max(100).optional()`. Hoy los constructores toman el
  schema y una máscara de paths, `(schema, { … })`, porque `.pick()` no toma paths con punto y sus
  sugerencias son las de Zod, del primer nivel; y `.max()` es de `ZodString`, que un constructor que
  devuelve un filtro solo tendría con una subclase propia de Zod. Se explora junto con
  `mz.from(schema)` de la fase 7 del [roadmap](../proposal/roadmap.md), sin perder los paths con
  punto ni las sugerencias.
