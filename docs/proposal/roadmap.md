# Roadmap

El orden de implementación. Al cerrar una fase, se marca acá en el mismo cambio.

1. **Estructura del proyecto**: las herramientas del repo (paquetes, build, tests, lint y formato),
   el CI y los releases. Ver [Estructura del repo](./structure.md).
2. **Modelo**, en este orden:
   1. Las operaciones y la validación al escribir. Ver [El modelo](./model.md) y
      [Operaciones](./operations.md).
   2. Los tipos estrictos y los paths con punto. Ver [Tipos](./types.md).
   3. Los updates en runtime: valores por path, reglas por operador y upserts. Ver
      [Paths con punto](./types.md#paths-con-punto) y la fila «Updates» de las
      [decisiones acordadas](./README.md#decisiones-acordadas).
   4. Las referencias y los virtuals. Ver [El modelo](./model.md).
   5. `sync()`: los índices y el `$jsonSchema`. Ver la fila «Servidor» de las
      [decisiones acordadas](./README.md#decisiones-acordadas).
3. **Plugins**: `definePlugin`, [`timestamps`](./plugins/timestamps.md) y
   [`softDelete`](./plugins/soft-delete.md). Ver [Plugins](./plugins/README.md).
4. **Inputs**: `mz`. Ver [Inputs de los endpoints](./inputs.md).
5. **Primera versión**: una 0.x en npm y un primer módulo de adsgpt migrado. Publicarla confirma el
   nombre, y su número no puede repetir ninguno de los que usó el autor anterior (ver
   [Qué se verificó](./verified.md)). Antes, adsgpt arregla wortise/adsgpt#230 y wortise/adsgpt#231,
   que no dependen de mongozod.
6. **Después**: [`audit`](./plugins/audit.md), [`logger`](./plugins/logger.md) y
   [`history`](./plugins/history.md); la documentación para usuarios, el sitio y los ejemplos; los
   demás módulos de adsgpt, uno por uno; y la v1.
