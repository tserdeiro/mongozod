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
4. **Inputs** (hecho): `mz`, en `mongozod/mz`. Ver [Inputs de los endpoints](./inputs.md).
5. **Primera versión**: una 0.x en npm y un primer módulo de adsgpt migrado. Publicarla confirma el
   nombre, y su número no puede repetir ninguno de los que usó el autor anterior (ver
   [Qué se verificó](./verified.md)). Antes, adsgpt arregla wortise/adsgpt#230 y wortise/adsgpt#231,
   que no dependen de mongozod.
6. **Después**: [`audit`](./plugins/audit.md), [`logger`](./plugins/logger.md) y
   [`history`](./plugins/history.md); la documentación para usuarios, el sitio y los ejemplos; los
   demás módulos de adsgpt, uno por uno; y la v1.
