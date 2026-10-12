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
   2. Lo que Mongoose no resolvió, de un repaso de sus issues abiertos y de los más votados (hecho;
      el detalle y el beneficio de cada punto, en [Los issues de Mongoose](../audits/mongoose-issues.md)):
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
      5. `mz.set(item)` (hecho): un array sin repetidos, con la igualdad del `uniqueItems` de
         MongoDB, que solo agrega con `$addToSet` y que `sync()` marca con `uniqueItems`
         ([Automattic/mongoose#3347](https://github.com/Automattic/mongoose/issues/3347),
         [#8082](https://github.com/Automattic/mongoose/issues/8082) y
         [#12916](https://github.com/Automattic/mongoose/issues/12916)). Devuelve un array y no un
         `Set`, porque las lecturas no se parsean. Ver
         [Inputs](./inputs.md#decisiones-de-los-inputs).
      6. El `limit` de `populate` por documento (hecho), no para todos juntos como en Mongoose
         ([Automattic/mongoose#15863](https://github.com/Automattic/mongoose/issues/15863)): corta
         cada array de ids, y en una uno a muchos, que exige un `sort`, hace una consulta por
         documento. Una sola con `$setWindowFields` no alcanza: el `aggregate` no pasa por los
         plugins del destino. Ver [Referencias](./model.md#referencias).
      7. Una referencia en otra key (hecho): con `localField` y sin `foreignField`, puebla
         `capital` desde `capitalId`, un documento o un array según lo que guarda el `localField`
         ([Automattic/mongoose#3225](https://github.com/Automattic/mongoose/issues/3225) y
         [#9034](https://github.com/Automattic/mongoose/issues/9034)). Ver
         [Referencias](./model.md#referencias).
      8. Un `sort` por defecto en el modelo (descartado,
         [Automattic/mongoose#16577](https://github.com/Automattic/mongoose/issues/16577)): la lista
         que pide un cliente ya tiene su orden por defecto con `mz.sort(…).default(…)`, visible en
         el input del endpoint. Uno implícito haría que un `find` sin `sort` no haga lo que dice el
         código, ordenaría en memoria las lecturas sin un índice que lo cubra y cambiaría qué
         devuelve un `findOne`.
      9. Los codecs de Temporal (pasa a la fase 7,
         [Automattic/mongoose#11462](https://github.com/Automattic/mongoose/issues/11462)): las
         lecturas no se parsean, así que el driver seguiría devolviendo un `Date` y Temporal solo
         llegaría a las escrituras; además, no lo tienen Node 22, el mínimo (viene sin flag desde
         Node 26), TypeScript 5.5 ni Safari, y `mongozod/mzod` corre en los clientes. Una fecha sin
         hora ya se valida con `z.iso.date()`, y la guía «Desde Mongoose» lo explica.
      10. Generar el schema de Zod de una colección (descartado,
          [Automattic/mongoose#14570](https://github.com/Automattic/mongoose/issues/14570)): un
          agente traduce mejor que un conversor, y nuestros proyectos ya están en Zod. Queda como
          paso del «Copy prompt».
      11. El cifrado de campos, CSFLE y Queryable Encryption (pasa a la fase 7,
          [Automattic/mongoose#13412](https://github.com/Automattic/mongoose/issues/13412)).
      12. Un plugin de integridad de las `references`, con el borrado en cascada (pasa a la fase 7,
          [Automattic/mongoose#15417](https://github.com/Automattic/mongoose/issues/15417) y
          [#8163](https://github.com/Automattic/mongoose/issues/8163)).

   3. El costo de los tipos (hecho): el proyecto típico de `pnpm check-type-cost` usaba el 95 % de
      sus dos límites (80.739 de 85.000 instanciaciones con TypeScript 7 y 90.434 de 95.000 con 5.5),
      después de la fase 6.2 y las correcciones de la [evaluación](../audits/evaluation.md). Once
      cambios lo bajan a 62.316 y 69.193 (−22,8 % y −23,5 %) sin cambiar lo que compila, los
      mensajes de mongozod ni las sugerencias del editor, y el límite baja a 67.000 y 74.000. Las
      reglas están en [Costo de los tipos](./types.md#costo-de-los-tipos), y el detalle en la
      [evaluación](../audits/evaluation.md#el-costo-de-los-tipos).
   4. El flujo de releases (hecho): el de [Herramientas](./structure.md#herramientas). Los 135
      changesets se juntan en uno, porque nadie usó lo que describen, y la versión es la 0.2.0:
      Changesets calcula la 0.1.0, que usó el autor anterior. Es la única que se publica a mano,
      con `pnpm changeset publish`, porque el trusted publisher necesita que el paquete exista.

   Con ella van, como dice [Documentación](./documentation.md):
   1. El README del paquete y de la raíz (hecho): qué es, cómo se instala, un ejemplo mínimo y que la API
      puede cambiar en la 0.x.
   2. Las páginas de `getting-started/` en `packages/docs`, con la copia al paquete y
      `pnpm check-docs` (hecho).
   3. La guía «Desde Mongoose» (hecho), en `packages/docs/mongoose/`, para que se lea en GitHub y en el sitio: las
      equivalencias, lo que mongozod hace distinto (sin documentos con `.save()`, sin casting de
      filtros) y las recetas, como el virtual `id` y `__v`. Deja claro que Mongoose y mongozod
      conviven sobre la misma conexión mientras se migra, modelo por modelo, con el driver 6.20 de
      Mongoose 8.19 en adelante o el 7 de Mongoose 9. Trae un «Copy prompt» para que cada equipo le pase la
      migración a su agente; sin un schema de Mongoose, el agente parte del `$jsonSchema` que arman
      Compass o `@mongodb-js/mongodb-schema` (el paquete `mongodb-schema` está deprecado). También lista los issues de Mongoose que mongozod resuelve:
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

      Entre las recetas va la fecha sin hora, como un cumpleaños: un string con `z.iso.date()`, que
      se ordena bien y no se corre de día por la zona horaria, como un `Date` a medianoche.

      Los [50 casos de uso](../audits/use-cases.md) suman estas recetas, que resuelven fricciones
      sin cambiar la librería:
      - el `_id` en sus tres formas: sin declarar, `mz.objectId().default(…)` y
        `z.uuidv4().default(…)` (F25);
      - comparar un `ObjectId` con `.equals()`, no con `instanceof` (F1);
      - un multi-tenant con una base por tenant, con un `Db` guardado por tenant (F5);
      - un repositorio o un `paginate` genérico con `ReadOf`, `FilterOf` e `InsertOf`, y la
        consulta como callback (F6);
      - el `pre('save')` de Mongoose como un `.transform(async)` del campo (F8), y un chequeo
        contra la base dentro de una transacción en el `before` de un plugin (F12);
      - agregar un campo con `.default()` o un virtual migrando los documentos viejos, y listar los
        inválidos con `safeParse` antes de migrar (F15 y F16);
      - un transform que no es idempotente, como un hash, y un campo derivado con `.overwrite()`
        (F17);
      - `z.prettifyError` para los logs (F19), y un GET con el filtro como JSON en un parámetro
        `q` (F21);
      - leer incluidos los borrados de `softDelete` (F29);
      - recorrer con `for await` y `Readable.from` (F32), y los change streams con
        `Model.collection.watch()` (F33);
      - los schemas recursivos con getters de Zod 4 (F35);
      - comparar un decimal con `Decimal128.fromString('9.99')` o con `mz.filter` (F18), y una key
        dinámica de un record con un objeto que tipa el patrón (F4).

      Antes de listarlos se verifican contra MongoDB dos que se suponen resueltos: que un objeto
      vacío se guarda
      ([#8505](https://github.com/Automattic/mongoose/issues/8505)) y que un upsert con
      `_id: null` falla ([#9201](https://github.com/Automattic/mongoose/issues/9201)).

7. **Después**: lo que dejó la [evaluación antes de la primera versión](../audits/evaluation.md): las sugerencias de los operadores de query en el editor, y las de `arrayFilters`, que piden intersectar dos arrays ([casos de uso](../audits/use-cases.md), F23), los tipos legibles al pasar el mouse por una lectura proyectada o poblada, los errores de configuración del modelo con el mensaje primero, las sugerencias de los updates filtradas por operador, y `select: false`, `immutable` y `alias` como plugins o recetas; que los tipos de `mz.update` acepten los paths que el editor no sugiere, como las keys de un record o de un catchall y los de más de 6 niveles: hoy no compilan con ningún operador, aunque su runtime los toma, como los updates del modelo; que un update cambie un discriminador `z.enum` a otro valor de la misma opción, en los tipos y en el runtime, cuando cada tipo que permite el filtro lo toma, y el mensaje de una proyección con keys `string` en la de un `populate`, donde TypeScript no elabora el error de una unión (R17, S16 y T6 de la [revisión de las correcciones](../audits/use-cases-fixes-review.md)); [`audit`](./plugins/audit.md), [`logger`](./plugins/logger.md) y
   [`history`](./plugins/history.md); `mz.from(schema)`, que ata los constructores de inputs a un
   schema para no repetirlo, `mz.from(brandSchema).filter({…})`, como la forma cómoda junto a los
   sueltos, que siguen siendo tree-shakeables (su objeto carga los seis); `mz.before`, la página anterior, como el
   `searchBefore` de Atlas Search, con el diseño de cómo el router invierte el `sort` y los
   resultados; un plugin de versión, el control de concurrencia optimista
   que Mongoose hace con `__v` y `optimisticConcurrency`: un campo que el filtro chequea y un `$inc`
   aumenta en cada escritura, con el nombre configurable, así sirve `__v` en los documentos que
   vienen de Mongoose (el nombre por defecto se decide al diseñarlo, quizás `_v`); el cifrado de campos, con los `encryptedFields` desde `.meta({ encrypt })` y verificando que el `$jsonSchema` no rechace los campos cifrados; un plugin de integridad de las `references`, con el borrado en cascada y la validación de que el referenciado existe; los codecs de Temporal, cuando los mínimos de Node y TypeScript lo traigan y se decida si las lecturas se parsean (lo que también le daría a `mz.set()` un `Set`); el resto de las páginas de la [documentación](./documentation.md), la skill de migración y el sitio, `apps/website` (hechos el 2026-10-12, junto con la fase 6); el despliegue del sitio en mongozod.dev y los links de los JSDoc a sus páginas (hechos el 2026-10-12); el playground del sitio,
   que muestre, para un schema, sus tipos, su `$jsonSchema` y lo que acepta cada constructor de
   `mongozod/mzod`; los ejemplos; los demás módulos de adsgpt, uno por uno; y la v1.
