# Los issues de Mongoose

Un repaso de los issues de Mongoose y de zod-mongoose, para encontrar lo que esas librerías no
resolvieron y mongozod puede resolver antes de su primera versión. Es la fase 6.2 del
[roadmap](../proposal/roadmap.md), commits `ec622c1` a `dcba255`.

- **Fuentes**: los 161 issues abiertos de
  [Automattic/mongoose](https://github.com/Automattic/mongoose/issues), los cerrados más votados,
  los de la etiqueta `typescript` y los 4 de
  [Harm-Nullix/zod-mongoose](https://github.com/Harm-Nullix/zod-mongoose/issues), leídos con `gh`.
- **Criterio**: lo que encaja con mongozod (Zod como fuente de verdad sobre el driver oficial),
  ordenado por votos, encaje y costo. Cada punto se verificó contra MongoDB 8.2 y TypeScript antes
  de decidirlo.
- **zod-mongoose** no aporta: dos de sus issues son genéricos de las opciones de Mongoose que se
  perdían, un problema que mongozod no tiene porque los tipos salen del schema.

## Resumen

| Punto                                     | Estado     | Beneficio                                                        |
| ----------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `exactOptionalPropertyTypes`              | Hecho      | Funciona con la configuración más estricta de TypeScript.        |
| Discriminators de varios niveles          | Hecho      | Resuelve el issue abierto más votado de Mongoose.                |
| El costo de los tipos como garantía       | Hecho      | El editor no se vuelve lento, el reclamo de tipos más votado.    |
| `mz.uuid()`                               | Hecho      | UUID en 16 bytes en vez de 36, con el tipo que leen los drivers. |
| `mz.set()`                                | Hecho      | Arrays sin repetidos garantizados, también por el servidor.      |
| `limit` por documento en `populate`       | Hecho      | Listas de «los últimos N» sin cargar todo.                       |
| Una referencia en otra key                | Hecho      | `capital` desde `capitalId`, sin perder el id.                   |
| `sort` por defecto en el modelo           | Descartado | Ya lo cubre `mz.sort().default()`, visible en el endpoint.       |
| Codecs de Temporal                        | Fase 7     | Esperan a que Node, TypeScript y Safari lo traigan.              |
| Generar el schema de Zod de una colección | Descartado | Un agente lo hace mejor; queda como paso del «Copy prompt».      |
| Cifrado de campos                         | Fase 7     | Nicho: requiere Atlas o Enterprise, y ningún proyecto lo usa.    |
| Plugin de integridad de las referencias   | Fase 7     | La necesidad más real de las tres, pero con un diseño grande.    |

## Lo que se hizo

### `exactOptionalPropertyTypes`

Con esa opción de TypeScript, lo que devuelven `mz.filter` y `mz.populate` no se podía pasar al
modelo: Zod tipa sus keys opcionales con `| undefined`, y los tipos del modelo no lo aceptaban. Es
el problema de [#16273](https://github.com/Automattic/mongoose/issues/16273), y lo encontramos
compilando el consumidor de `dist/` con la opción.

- **Qué se hizo**: los tipos aceptan `undefined` en las keys opcionales, y la configuración base del
  repo activa la opción, así los tests la prueban siempre. Un `{ title: undefined }` escrito a mano
  sigue sin compilar, porque el driver lo manda como `null`.
- **Beneficio**: los equipos con la configuración más estricta no tienen que elegir entre esa
  opción y mongozod. Era un error nuestro, no solo de Mongoose.

### Discriminators de varios niveles

Una `z.discriminatedUnion` dentro de otra, para tipos con subtipos, como un vehículo que es un auto
eléctrico o a nafta, o una bici. Es el issue abierto más votado de Mongoose, de 2015
([#2851](https://github.com/Automattic/mongoose/issues/2851)).

- **Qué se hizo**: en runtime ya funcionaba; faltaba que los tipos del modelo lo aceptaran. Cada
  nivel tiene su key, y un update fija en el filtro las de los tipos que escribe. `timestamps` y los
  plugins exigen sus campos en cada tipo final. Se aceptan tres niveles, porque un tipo recursivo da
  TS2589.
- **Beneficio**: modelar jerarquías de tipos con la herramienta estándar de Zod, con los updates
  chequeados nivel por nivel, algo que Mongoose no tiene.

### El costo de los tipos como garantía

El issue de tipos más votado de Mongoose
([#10349](https://github.com/Automattic/mongoose/issues/10349), 70 votos y 217 comentarios) es que
vuelve lento al editor.

- **Qué se hizo**: `pnpm check-type-cost` compila con TypeScript 5.5 y 7 un proyecto típico desde
  `dist/` y falla si sus instanciaciones de tipos pasan un límite. Solo gatea las instanciaciones,
  que son determinísticas; el tiempo se informa, porque en CI varía.
- **Beneficio**: tipos estrictos sin pagar con un editor lento, y cualquier cambio que los encarezca
  se ve en el PR. Hoy el proyecto típico usa el 94 % del límite con TS 7 y el 95 % con TS 5.5.

### `mz.uuid()`

Un UUID guardado como `Binary` de subtipo 4
([#3208](https://github.com/Automattic/mongoose/issues/3208)).

- **Qué se hizo**: toma el string de un UUID o un `UUID` y devuelve un `UUID`, que es lo que leen
  bson 6.10 y 7 (verificado), así que un documento leído vuelve a escribirse. Su `toJSON()` da el
  string, así que las respuestas JSON lo muestran legible.
- **Beneficio**: 16 bytes por UUID en vez de 36, en los documentos y en los índices, sin perder la
  comodidad del string en la API.

### `mz.set()`

Un array que guarda cada valor una vez
([#3347](https://github.com/Automattic/mongoose/issues/3347), 35 votos).

- **Qué se hizo**: un valor repetido lanza un `ZodError`, con la igualdad del `uniqueItems` de
  MongoDB (verificado: los números por su valor y los objetos sin importar el orden de sus campos).
  Los updates solo agregan con `$addToSet`; `$push` y escribir un elemento por índice no compilan.
  `sync()` pone `uniqueItems: true`, así el servidor también rechaza un repetido que llega por otro
  lado.
- **Beneficio**: tags, roles o miembros sin duplicados, garantizado en tres capas: los tipos, el
  runtime y el servidor.

### `limit` por documento en `populate`

En Mongoose, el `limit` de `populate` cuenta los documentos de todo el lote
([#15863](https://github.com/Automattic/mongoose/issues/15863)).

- **Qué se hizo**: en un array de ids se corta cada array; en una referencia uno a muchos, que
  exige un `sort`, se hace una consulta por documento, a través del modelo referenciado. Una sola
  consulta con `$setWindowFields` no alcanza: el `aggregate` no pasa por los plugins del destino, y
  un `softDelete` contaría los borrados.
- **Beneficio**: «cada cuenta con sus últimas 5 transacciones» trae exactamente eso, sin cargar
  todas las transacciones.

### Una referencia en otra key

Poblar `capital` desde `capitalId` sin perder el id
([#3225](https://github.com/Automattic/mongoose/issues/3225) y
[#9034](https://github.com/Automattic/mongoose/issues/9034)), lo que Mongoose resuelve con un
virtual populate y `justOne`.

- **Qué se hizo**: una referencia con `localField` y sin `foreignField`. El valor sigue a lo que
  guarda el `localField`: un documento o `null` si guarda un id, y un array si guarda un array.
  Busca por `_id`, que es único, así que no hace falta un `justOne` que podría elegir uno cualquiera.
- **Beneficio**: el campo `capitalId` sigue siendo un id y `capital` el documento, cada uno con su
  tipo, sin un flag que declarar.

## Lo que se descartó o se postergó

- **`sort` por defecto en el modelo**
  ([#16577](https://github.com/Automattic/mongoose/issues/16577)): descartado. La lista que pide un
  cliente ya tiene su orden por defecto con `mz.sort().default()`. Uno implícito haría que un `find`
  sin `sort` no haga lo que dice el código, y ordenaría en memoria las lecturas sin un índice.
- **Codecs de Temporal** ([#11462](https://github.com/Automattic/mongoose/issues/11462)): fase 7.
  Las lecturas no se parsean, así que el driver seguiría devolviendo un `Date`. Además, no lo tienen
  Node 22, el mínimo, TypeScript 5.5 ni Safari. Una fecha sin hora ya se valida con `z.iso.date()`.
- **Generar el schema de Zod de una colección**
  ([#14570](https://github.com/Automattic/mongoose/issues/14570)): descartado. Nuestros proyectos ya
  tienen sus schemas en Zod, y para migrar desde Mongoose un agente traduce mejor que un conversor:
  el `toJSONSchema()` de Mongoose pierde los `ref` y marca casi todo como nullable (verificado). La
  guía suma un paso al «Copy prompt»: sin schema, sacar el `$jsonSchema` con Compass o
  `mongodb-schema` y pedirle al agente que lo traduzca.
- **Cifrado de campos** ([#13412](https://github.com/Automattic/mongoose/issues/13412)): fase 7.
  mongozod ya funciona con un `MongoClient` que cifra; declararlo en el schema solo cambia dónde se
  configura. Queda por verificar que el `$jsonSchema` no rechace los campos cifrados.
- **Plugin de integridad de las referencias**
  ([#15417](https://github.com/Automattic/mongoose/issues/15417) y
  [#8163](https://github.com/Automattic/mongoose/issues/8163)): fase 7. Es la necesidad más real,
  pero necesita transacciones, convivir con `softDelete` y limpiar arrays con `$pull`. Mongoose
  tampoco lo tiene, así que no bloquea la v1.

## Lo que mongozod ya resolvía

Estos issues de Mongoose ya estaban resueltos por el diseño de mongozod, y van a la guía «Desde
Mongoose»:

- **Validar los updates**: los campos obligatorios en un upsert
  ([#7037](https://github.com/Automattic/mongoose/issues/7037)), los subdocumentos
  ([#5234](https://github.com/Automattic/mongoose/issues/5234)) y todos los errores juntos
  ([#3037](https://github.com/Automattic/mongoose/issues/3037)).
- **Tipar**: las proyecciones con paths con punto
  ([#16575](https://github.com/Automattic/mongoose/issues/16575)), las funciones genéricas sobre
  modelos ([#14459](https://github.com/Automattic/mongoose/issues/14459)), `populate`
  ([#16010](https://github.com/Automattic/mongoose/issues/16010)) y `timestamps`
  ([#12069](https://github.com/Automattic/mongoose/issues/12069)).
- **Filtrar sin castear**: un `$match` con un string en vez de un `ObjectId` no compila
  ([#1399](https://github.com/Automattic/mongoose/issues/1399)), ni un valor fuera del enum
  ([#15581](https://github.com/Automattic/mongoose/issues/15581)).
- **Incluido**: GeoJSON ([#6606](https://github.com/Automattic/mongoose/issues/6606)) y soft delete
  ([#7304](https://github.com/Automattic/mongoose/issues/7304)).
- **`sync()` explícito**: los índices y las colecciones no se crean solos
  ([#15803](https://github.com/Automattic/mongoose/issues/15803) y
  [#13546](https://github.com/Automattic/mongoose/issues/13546)).

Dos más se suponen resueltos y se verifican antes de afirmarlo: que un objeto vacío se guarda
([#8505](https://github.com/Automattic/mongoose/issues/8505)) y que un upsert con `_id: null` falla
([#9201](https://github.com/Automattic/mongoose/issues/9201)).
