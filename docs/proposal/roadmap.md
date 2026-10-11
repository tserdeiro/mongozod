# Roadmap

El orden de implementación. Al cerrar una fase, se marca acá en el mismo cambio.

1. **Estructura del proyecto** (hecho): las herramientas del repo (paquetes, build, tests, lint y
   formato), el CI y los releases. Ver [Estructura del repo](./structure.md#herramientas).
2. **Modelo** (hecho), en este orden:
   1. Las operaciones y la validación al escribir (hecho). Los updates pasan sin validar hasta la
      2.3, y los filtros, updates y proyecciones usan los tipos del driver hasta la 2.2. Ver
      [El modelo](./model.md) y [Operaciones](./operations.md).
   2. Los tipos estrictos y los paths con punto (hecho), en este orden. Ver [Tipos](./types.md).
      1. El recorrido de los paths, en los tipos y en runtime, y el `Error` por los nombres de
         campo con `.` o `$` (hecho).
      2. Los filtros, con todos los operadores, también en el `$match` de `aggregate` y en `sort`
         (hecho).
      3. Los tipos de los updates: los operadores, las uniones y los `arrayFilters` (hecho).
      4. Las proyecciones, con el tipo de su resultado (hecho).
      5. El job de CI que compila los `.d.ts` publicados con TS 5.5 y 7 (hecho).
   3. Los updates en runtime: valores por path, reglas por operador y upserts (hecho). Ver
      [Paths con punto](./types.md#paths-con-punto) y la fila «Updates» de las
      [decisiones acordadas](./README.md#decisiones-acordadas).
   4. `timestamps` (hecho). Ver [Timestamps](./model.md#timestamps).
   5. Las referencias y los virtuals (hecho). Ver [Referencias](./model.md#referencias) y
      [Virtuals](./model.md#virtuals).
   6. `sync()`: los índices y el `$jsonSchema` (hecho). Ver [Sincronización](./model.md#sincronización).
3. **Plugins** (hecho), en este orden. Ver [Plugins](./plugins/README.md).
   1. El contrato: `definePlugin`, los hooks, el `middleware`, las opciones, el contexto y los
      métodos (hecho).
   2. [`softDelete`](./plugins/soft-delete.md), en `mongozod/plugins/soft-delete` (hecho).
4. **Inputs** (hecho): `mz`, en `mongozod/mzod`. Ver [Inputs de los endpoints](./inputs.md).
5. **Reemplazo de Mongoose** (hecho): lo que falta para que mongozod reemplace a Mongoose en sus funciones
   principales, que es el [criterio de la v1](./README.md#objetivo). Sale de la
   [auditoría de las fases 1 a 4](../audits/phases-1-4.md#decidir), con los puntos ya decididos, en
   este orden:
   1. El driver 6.20 en el peer (`^6.20.0 || ^7.0.0`), con un job de CI (hecho). Ver
      [Decisiones acordadas](./README.md#decisiones-acordadas).
   2. `mz.objectId()` y `mz.date()` (hecho). Ver [Inputs](./inputs.md#decisiones-de-los-inputs).
   3. `timestamps` sin `.default()` (hecho). Ver [Timestamps](./model.md#timestamps).
   4. Los updates con pipeline, con `updatePipeline: true` (hecho). Ver [Updates](./types.md#updates).
   5. `populate`, en este orden: el valor como objeto, con `filter` y `sort` (hecho); las referencias en
      subdocumentos y arrays (hecho); el `populate` anidado (hecho); y el uno a muchos con `foreignField` (hecho). Ver
      [Referencias](./model.md#referencias).

   El casting de los filtros no se implementa: se documenta como diferencia con Mongoose (ver
   [Filtros](./types.md#filtros)).

6. **Primera versión**: una 0.x en npm y un primer módulo de adsgpt migrado. Publicarla confirma el
   nombre, y su número no puede repetir ninguno de los que usó el autor anterior (ver
   [Qué se verificó](./verified.md)). Antes, adsgpt arregla wortise/adsgpt#230 y wortise/adsgpt#231,
   que no dependen de mongozod. Antes de publicarla:
   1. Los tipos BSON que todavía no tienen una forma cómoda:
      1. `.meta({ bsonType })`, la API de metadata de Zod, en el `$jsonSchema` (hecho): un campo sin codec,
         como `z.instanceof(Decimal128).meta({ bsonType: 'decimal' })`, declara su tipo BSON. Los
         codecs usan el mismo mecanismo, y desaparece el registro propio de `objectId()`.
      2. `mz.decimal128()` (hecho): un string o un número exacto ↔ `Decimal128`, el tipo para
         dinero.
      3. `mz.binary()` (hecho): base64, un `Uint8Array` o un `Binary` ↔ un `Binary`, el tipo con el
         que el driver lee los binarios.
      4. GeoJSON (hecho): `mz.point()`, `mz.lineString()`, `mz.polygon()`, sus `Multi*` y
         `mz.geometryCollection()`,
         con las reglas de MongoDB para los índices `2dsphere` (`[longitud, latitud]`, sus rangos
         y los anillos cerrados). No son codecs: validan la forma, sin convertir valores.
   2. Lo que Mongoose no resolvió, de un repaso de sus issues abiertos y de los más votados:
      1. `exactOptionalPropertyTypes` (hecho): lo que devuelve un schema de `mz` se pasa al modelo
         con esa opción, el problema de
         [Automattic/mongoose#16273](https://github.com/Automattic/mongoose/issues/16273).
      2. Los discriminators de varios niveles (hecho): una `z.discriminatedUnion` dentro de otra,
         hasta tres niveles. Ver [Varios tipos de documento](./model.md#varios-tipos-de-documento).
         Es el issue abierto más votado,
         [Automattic/mongoose#2851](https://github.com/Automattic/mongoose/issues/2851), con
         [#8361](https://github.com/Automattic/mongoose/issues/8361) y
         [#9756](https://github.com/Automattic/mongoose/issues/9756).
      3. El costo de los tipos como garantía (hecho): `pnpm check-type-cost` en CI, con un límite
         de instanciaciones; el tiempo de chequeo se informa sin fallar, porque varía entre
         corridas. Ver [Herramientas](./structure.md#herramientas). Mongoose vuelve lento al editor
         ([Automattic/mongoose#10349](https://github.com/Automattic/mongoose/issues/10349)).
      4. `mz.uuid()` (hecho): el string de un UUID ↔ un `UUID`, el `Binary` de subtipo 4 con el que
         lee el driver. Ver [Inputs](./inputs.md#decisiones-de-los-inputs).
      5. `mz.set(item)`: un array sin repetidos ↔ un `Set`, cuyos updates solo aceptan
         `$addToSet`, ni `$push` ni un `$set` por índice, así la unicidad queda garantizada dentro
         del documento sin un índice
         ([Automattic/mongoose#3347](https://github.com/Automattic/mongoose/issues/3347),
         [#8082](https://github.com/Automattic/mongoose/issues/8082) y
         [#12916](https://github.com/Automattic/mongoose/issues/12916)).
      6. El `limit` de `populate` por documento, no para todos juntos como en Mongoose
         ([Automattic/mongoose#15863](https://github.com/Automattic/mongoose/issues/15863)). Se
         verifica si sale en una consulta con `$setWindowFields`, particionando por el
         `foreignField`.
      7. Una referencia con `localField` que devuelve un documento y no un array, para poblar
         `capital` desde `capitalId`
         ([Automattic/mongoose#3225](https://github.com/Automattic/mongoose/issues/3225) y
         [#9034](https://github.com/Automattic/mongoose/issues/9034)).
      8. Un `sort` por defecto en el modelo, para las lecturas que no mandan uno
         ([Automattic/mongoose#16577](https://github.com/Automattic/mongoose/issues/16577)).
      9. Los codecs de Temporal ↔ `Date`, si la versión mínima de Node lo trae sin flag
         ([Automattic/mongoose#11462](https://github.com/Automattic/mongoose/issues/11462)).
      10. Generar el schema de Zod de una colección, desde su `$jsonSchema` o una muestra de
          documentos, como `prisma db pull`, y desde un schema de Mongoose para migrar
          ([Automattic/mongoose#14570](https://github.com/Automattic/mongoose/issues/14570)).
      11. El cifrado de campos (CSFLE y Queryable Encryption): `sync()` arma los `encryptedFields`
          desde `.meta({ encrypt })`, como `bsonType`
          ([Automattic/mongoose#13412](https://github.com/Automattic/mongoose/issues/13412)).
      12. Un plugin de integridad de las `references`: el borrado en cascada y la validación de que
          el documento referenciado existe
          ([Automattic/mongoose#15417](https://github.com/Automattic/mongoose/issues/15417) y
          [#8163](https://github.com/Automattic/mongoose/issues/8163)).

   Con ella van:
   1. El README del paquete y de la raíz: qué es, cómo se instala, un ejemplo mínimo y que la API
      puede cambiar en la 0.x.
   2. La guía «Desde Mongoose», en `docs/`, para que se lea en GitHub y en el sitio: las
      equivalencias, lo que mongozod hace distinto (sin documentos con `.save()`, sin casting de
      filtros) y las recetas, como el virtual `id` y `__v`. Deja claro que Mongoose y mongozod
      conviven sobre la misma conexión mientras se migra, modelo por modelo, con el driver 6 de
      Mongoose 8 o el 7 de Mongoose 9. Trae un «Copy prompt» para que cada equipo le pase la
      migración a su agente. También lista los issues de Mongoose que mongozod resuelve:
      - **Validar los updates:**
        - un upsert sin los campos obligatorios
          ([#7037](https://github.com/Automattic/mongoose/issues/7037));
        - los subdocumentos
          ([#5234](https://github.com/Automattic/mongoose/issues/5234));
        - todos los errores juntos
          ([#3037](https://github.com/Automattic/mongoose/issues/3037)).
      - **Tipar:**
        - las proyecciones con paths con punto
          ([#16575](https://github.com/Automattic/mongoose/issues/16575));
        - las funciones genéricas sobre modelos
          ([#14459](https://github.com/Automattic/mongoose/issues/14459));
        - `populate`
          ([#16010](https://github.com/Automattic/mongoose/issues/16010));
        - `timestamps`
          ([#12069](https://github.com/Automattic/mongoose/issues/12069)).
      - **Filtrar sin castear:**
        - un `$match` con un string en vez de un `ObjectId` no compila
          ([#1399](https://github.com/Automattic/mongoose/issues/1399));
        - un valor que no está en el enum tampoco
          ([#15581](https://github.com/Automattic/mongoose/issues/15581)).
      - **Ya incluidos:**
        - GeoJSON
          ([#6606](https://github.com/Automattic/mongoose/issues/6606));
        - el soft delete
          ([#7304](https://github.com/Automattic/mongoose/issues/7304)).
      - **`sync()` explícito:** los índices y las colecciones no se crean solos
        ([#15803](https://github.com/Automattic/mongoose/issues/15803) y
        [#13546](https://github.com/Automattic/mongoose/issues/13546)).

      Antes de listarlos se verifican contra MongoDB dos que se suponen resueltos: que un objeto
      vacío se guarda
      ([#8505](https://github.com/Automattic/mongoose/issues/8505)) y que un upsert con
      `_id: null` falla ([#9201](https://github.com/Automattic/mongoose/issues/9201)).

7. **Después**: [`audit`](./plugins/audit.md), [`logger`](./plugins/logger.md) y
   [`history`](./plugins/history.md); `mz.from(schema)`, que ata los constructores de inputs a un
   schema para no repetirlo, `mz.from(brandSchema).filter({…})`, como la forma cómoda junto a los
   sueltos, que siguen siendo tree-shakeables (su objeto carga los seis); `mz.before`, la página anterior, como el
   `searchBefore` de Atlas Search, con el diseño de cómo el router invierte el `sort` y los
   resultados; un plugin de versión, el control de concurrencia optimista
   que Mongoose hace con `__v` y `optimisticConcurrency`: un campo que el filtro chequea y un `$inc`
   aumenta en cada escritura, con el nombre configurable, así sirve `__v` en los documentos que
   vienen de Mongoose (el nombre por defecto se decide al diseñarlo, quizás `_v`); la documentación para usuarios; el sitio, con un playground
   que muestre, para un schema, sus tipos, su `$jsonSchema` y lo que acepta cada constructor de
   `mongozod/mzod`; los ejemplos; los demás módulos de adsgpt, uno por uno; y la v1.
