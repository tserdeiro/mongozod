# Estructura del repo

| Carpeta o archivo     | Contenido                                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/mongozod/`  | El paquete `mongozod`. Los plugins oficiales son subpaths del paquete, como `mongozod/plugins/soft-delete`, así que se instala un solo paquete, con una sola versión. Un plugin pasa a ser un paquete aparte, en `packages/`, solo si necesita una dependencia propia. |
| `packages/config/`    | La configuración compartida, por ahora la base de TypeScript (`@repo/config/typescript/base`). Es privado y no se publica.                                                                                                                                             |
| `packages/docs/`      | La documentación para usuarios, en `.md`: `@repo/docs`, privado. El build del paquete la copia a `dist/docs/`, y la lee el sitio. Ver [Documentación](./documentation.md).                                                                                             |
| `apps/website/`       | El sitio, [mongozod.dev](https://mongozod.dev), con Next.js y Fumadocs. Todavía no existe.                                                                                                                                                                             |
| `examples/<ejemplo>/` | Los ejemplos de uso, como `nextjs`, `tanstack-start` y `tanstack-router-trpc`.                                                                                                                                                                                         |
| `docs/`               | Esta propuesta (`proposal/`) y las auditorías (`audits/`), en español, para quien trabaja en el repo.                                                                                                                                                                  |
| `skills/`             | Las skills para agentes.                                                                                                                                                                                                                                               |
| `.changeset/`         | Los changesets de cada cambio y la configuración de [Changesets](https://changesets.dev).                                                                                                                                                                              |
| `.github/`            | El CI, los releases y el chequeo de los nombres de commits y pull requests.                                                                                                                                                                                            |
| `AGENTS.md`           | Las instrucciones para los agentes que trabajan en el repo.                                                                                                                                                                                                            |
| `README.md`           | La presentación del proyecto: un symlink a `packages/mongozod/README.md`, el que publica npm.                                                                                                                                                                          |
| `LICENSE`             | La licencia, Apache 2.0. `packages/mongozod/` lleva una copia, porque npm solo publica la que está en el paquete.                                                                                                                                                      |

## El código del paquete

`packages/mongozod/src` se organiza por tema. Cada tipo vive junto a su gemelo de runtime, como
`SchemaAt` y `schemaAt`, y cada test junto a su archivo.

| Carpeta o archivo   | Contenido                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`          | El entry de `mongozod`: `mongozod()`, `definePlugin`, los cursores y los tipos públicos.                                                                                                                  |
| `mongozod.ts`       | `mongozod()`, que arma el modelo.                                                                                                                                                                         |
| `model/`            | El modelo: su interfaz, los cursores, el plan de las lecturas, la validación de los documentos, `timestamps` y `sync()` (índices y `$jsonSchema`).                                                        |
| `updates/`          | Los updates en runtime: la validación por path, el recorrido de los paths y los upserts.                                                                                                                  |
| `references/`       | `references`, `populate` y los virtuals.                                                                                                                                                                  |
| `types/`            | Los tipos estrictos de las consultas: filtros, updates, proyecciones, `sort`, pipelines y las sugerencias de paths.                                                                                       |
| `schema/`           | El recorrido de los schemas de Zod: los paths, los wrappers, y los tipos de documento.                                                                                                                    |
| `plugins/`          | El contrato de plugins, su runtime y sus chequeos, y los plugins oficiales, cada uno su entry.                                                                                                            |
| `mzod.ts` y `mzod/` | El entry de `mongozod/mzod`, el Zod de MongoDB: un archivo por constructor, `mzod/fields/` con los tipos de campo (`bson`, `date` y `geojson`) y `mzod/internal/` con lo que comparten los constructores. |
| `utils/`            | Lo genérico: `isPlainObject` y los helpers de tipos.                                                                                                                                                      |

- **Sin barrels**: los únicos archivos que reexportan son los entry points del paquete, que los
  `exports` del `package.json` necesitan.
- **Tree shaking**: el paquete declara `sideEffects: false`, cada entry exporta funciones con
  nombre, y el build no junta los módulos (`unbundle` de tsdown): `dist/` repite la estructura de
  `src/`, así un bundler deja afuera los módulos que no se usan. Un objeto que junta funciones, como
  era `mz`, lo impide, y también un build que junta los tipos de campo en un archivo: un cliente que
  usaba `mz.sort` y `mz.date` cargaba `bson` por el codec de `mz.decimal128()`, que se arma al cargar
  el módulo.

## Convenciones

- **Idioma**: la propuesta está en español. El README, la documentación para usuarios, `AGENTS.md`,
  las skills y los JSDoc van en inglés.
- **Referencias**: los documentos se citan entre sí con links relativos, como
  `[Tipos](./types.md)`.

## Herramientas

- **pnpm** con workspaces, y `savePrefix: ''` para versiones exactas. Respeta la edad mínima de
  publicación de pnpm: no instala una versión publicada hace menos de un día.
- **Turborepo** corre `build`, `check-types` y `test` en cada paquete. `check-types` y `test`
  dependen de un nodo `transit`, como recomienda su guía, para correr en paralelo sin perder los
  cambios de las dependencias.
- **TypeScript 7** con la base de `packages/config/`, que activa `exactOptionalPropertyTypes` para
  que los tests prueben los tipos con esa opción, y el consumidor de los `.d.ts` los prueba sin
  ella. TypeScript 5.5.4, el mínimo, se instala con el alias `typescript-5.5` para compilar ese
  consumidor.
- **tsdown** compila el paquete a ESM con sus `.d.ts`, escribe el `exports` del `package.json` y
  corre [publint](https://publint.dev) (estricto) y
  [arethetypeswrong](https://arethetypeswrong.github.io) (perfil `esm-only`), que hacen fallar el
  build. Los `.d.ts` salen de TypeScript 7 a través de tsgo, que rolldown-plugin-dts soporta como
  experimental y avisa en cada build. Por ese aviso no se usa `failOnWarn`.
- **Oxc**: oxlint y oxfmt desde la raíz, con las reglas generales de adsgpt, sin las de React (irán
  con los `examples/`). El lint usa tipos (`typeAware`, con oxlint-tsgolint) y prohíbe los `as` y
  los `!`.
- **Vitest** con [mongodb-memory-server](https://typegoose.github.io/mongodb-memory-server/): un
  replica set de un miembro, porque las transacciones lo necesitan, con MongoDB 8.2.6 fijado en el
  `package.json` del paquete. Los tests reciben su URI con `inject('mongoUri')`.
- **lefthook** corre lint, formato, tipos y tests antes de cada commit.
- **CI** (GitHub Actions, con `pnpm/setup`): lint, formato, tipos y build; los tests en Node 22.15
  (el mínimo), 24 y 26, y en Bun con `bun --bun vitest run`. Un job instala el driver 6.20, el más
  bajo del peer, con bson 6, y corre con ellos los tipos, los tests y el build. Después del build,
  `pnpm check-dist-types` compila con TS 5.5 y 7 un consumidor de los `.d.ts` publicados
  (`packages/mongozod/test/consumer/`), con `skipLibCheck: false`, y `pnpm check-type-cost` mide
  con TS 5.5 y 7 las instanciaciones de tipos de un proyecto típico
  (`packages/mongozod/test/type-cost/`): falla si pasan su `budget.json`, que tiene un margen de
  alrededor del 7 % sobre lo medido. Son lo que paga el editor en cada chequeo, y el mismo código
  con las mismas versiones da siempre el mismo número. El tiempo de chequeo se informa pero no
  falla, porque en CI varía de una corrida a otra. Un cambio que sube el costo a propósito sube el
  límite en el mismo commit. Por último, `pnpm check-docs` compila los ejemplos de los docs y del
  README contra los `.d.ts` publicados (ver [Documentación](./documentation.md#redacción)), y el
  `test` de `@repo/docs` chequea su índice y sus links.
- **Releases** con Changesets y el workflow de trusted publishing de su guía: cada push a `main`
  abre o actualiza el PR de versión, y al mergearlo publica en npm. El trusted publisher se
  configura en npm después de la primera publicación (fase 6).

## Documentación

El sitio, el formato de los docs y cómo llegan a los agentes están en
[Documentación](./documentation.md).
