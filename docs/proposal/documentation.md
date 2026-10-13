# Documentación

La documentación para usuarios, en inglés: el README, las páginas de los docs, lo que lee un agente
y el sitio, [mongozod.dev](https://mongozod.dev). Es una sola fuente, que se lee en GitHub, en el
sitio y en `node_modules`, como hace [Next.js](https://nextjs.org/docs/app/guides/ai-agents).

## Dónde vive

| Lugar                          | Qué tiene                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/docs/`               | `@repo/docs`, privado: las páginas en `.md`, la única fuente. No depende de nada: lo consumen el paquete y el sitio.                                                     |
| `packages/mongozod/dist/docs/` | La copia de las páginas que hace el build, con el `copy` de tsdown. Un agente la lee en `node_modules/mongozod/dist/docs/`, de la versión instalada.                     |
| `packages/mongozod/README.md`  | El README de npm. El `README.md` de la raíz es un symlink a este, como en Zod, así GitHub y npm muestran el mismo.                                                       |
| `apps/website/`                | El sitio, con Next.js y [Fumadocs](https://www.fumadocs.dev), que lee las páginas de `@repo/docs`. Turborepo pone las aplicaciones en `apps/` y lo demás en `packages/`. |
| `skills/`                      | Las skills de flujos de trabajo, que instala `npx skills add tserdeiro/mongozod`.                                                                                        |
| `docs/`                        | Sin cambios: esta propuesta y las auditorías, en español, para quien trabaja en el repo.                                                                                 |

`packages/mongozod` depende de `@repo/docs` como devDependency, así el `build`, que copia las
páginas, pierde el cache de Turborepo cuando cambia una: el `^build` crea un nodo en `@repo/docs`
aunque no tenga ese script, como los nodos `transit`. `@repo/docs` no depende del paquete, para
que no haya un ciclo.

## Formato

Markdown con GFM, sin MDX: se ve igual en GitHub, en `node_modules` y en el sitio, y un agente lee
Markdown limpio, sin JSX. Lo que agrega el sitio sale de plugins de remark sobre sintaxis que GitHub
ya muestra: las alertas `> [!NOTE]`, las pestañas de npm, pnpm, yarn y bun, y los títulos de los
bloques de código.

- Cada página empieza con un frontmatter con `title` y `description`, que usan el índice, el
  sidebar y el `llms.txt`.
- El orden lo dan los `meta.json` de cada carpeta, con el formato de
  [Fumadocs](https://www.fumadocs.dev/docs/page-conventions).
- `packages/docs/README.md` es el índice: el título y la descripción de cada página, en el orden de
  los `meta.json`. Lo escribe `pnpm --filter @repo/docs index`, y el `test` de `@repo/docs` falla si
  no está al día. GitHub lo muestra al abrir la carpeta, y un agente lo encuentra en
  `dist/docs/README.md`.

## Redacción

- Una página por tema, con el ejemplo primero, como Zod.
- Los ejemplos importan lo que usan y compilan: `pnpm check-docs` los compila contra los `.d.ts`
  publicados, como `check-dist-types`, y marca el error en la línea de la página. Los bloques de una
  página forman un módulo, en orden: un ejemplo usa el modelo de uno anterior y no repite sus
  imports. `db` y `client` vienen declarados, para no repetir la conexión. Un bloque con `separate`
  en su línea de apertura (` ```ts separate `) compila solo, y uno con `nocheck` no compila, como el
  código de Mongoose: el lenguaje es la primera palabra, como dice CommonMark, así que GitHub lo
  colorea igual.
- El código se escribe para leerse (pedido del maintainer, 2026-10-12): `import * as z from 'zod'`;
  los objetos que declaran algo (un schema, las opciones de `mongozod()`, un plugin, los campos de
  `mz.filter`) van una prop por línea, con una línea en blanco tras la llave y entre props; las
  cadenas de Zod, un método por línea, y `z.string().array()` en vez de `z.array(z.string())`; un
  schema siempre en su `const`, nunca inline en `mongozod()` o `aggregate()`; sin defaults de
  relleno como `?? 'mongodb://localhost:27017'`. Los filtros, updates y opciones cortas de una
  consulta quedan en una línea. Como oxfmt juntaría esas cadenas, `.oxfmtrc.json` no formatea el
  código dentro de los `.md` (`embeddedLanguageFormatting: "off"`).
- Las guías con trampas terminan en «Common mistakes».
- Los nombres son los de MongoDB y Zod, y los links entre páginas son relativos.
- Cada afirmación sobre Mongoose cita su documentación o su issue.

## Páginas

```
packages/docs/
├── README.md                    el índice, generado
├── index.md                     qué es, el aviso de marca y un ejemplo de 30 segundos
├── getting-started/
│   ├── why-mongozod.md          la comparación con Mongoose y con el driver y Zod a mano, con los issues de Mongoose que resuelve
│   ├── installation.md          los peers, los mínimos, Yarn y el peer `bson`, Bun
│   ├── quick-start.md           schema, modelo, escribir y leer, y un endpoint con `mz`
│   └── ai-agents.md             las docs instaladas, el bloque de `AGENTS.md`, `llms.txt` y las skills
├── guides/
│   ├── schemas.md               el `_id` en sus tres formas, defaults, `.overwrite()`, input y output, Zod Mini, lo que se rechaza
│   ├── models.md                `mongozod()`: `schema`, `collection` y `db`, también como función
│   ├── operations.md            las operaciones, los cursores, lo que no envuelve (`.collection`)
│   ├── validation.md            qué se valida y cuándo, los upserts, los refinements asíncronos, `ZodError`
│   ├── typescript.md            filtros, updates y proyecciones estrictos, paths con punto, los tipos exportados
│   ├── bson-types.md            los tipos de campo de `mz` y `.meta({ bsonType })`
│   ├── endpoint-inputs.md       `mz.filter`, `mz.update`, `mz.sort`, `mz.projection` y `mz.populate`
│   ├── security.md              lo que protegen los constructores y lo que queda en la aplicación
│   ├── pagination.md            `mz.after`, `skip` y `limit`
│   ├── populate.md              `references` y `populate`
│   ├── virtuals.md
│   ├── timestamps.md
│   ├── document-types.md        las `z.discriminatedUnion`
│   ├── aggregation.md           `aggregate(pipeline, { schema })`
│   ├── sync.md                  los índices, el `$jsonSchema` y `extraIndexes`
│   ├── transactions.md          `withSession` y `withTransaction` del driver
│   └── plugins.md               usar plugins y el contexto
├── plugins/
│   ├── soft-delete.md
│   └── writing-plugins.md       `definePlugin`
├── mongoose/
│   ├── index.md                 migrar modelo por modelo sobre la misma conexión, con el «Copy prompt»
│   ├── cheatsheet.md            las equivalencias
│   └── differences.md           sin `.save()`, sin casting, `__v`, `sync()` explícito
├── recipes/                     las recetas del roadmap (fase 6), agrupadas
│   ├── ids.md · multi-tenant.md · repositories.md · transforms.md
│   └── schema-migrations.md · http-apis.md · streams.md · dates-and-money.md · schema-patterns.md
└── api/
    ├── mongozod.md              lo que exporta `mongozod`
    └── mzod.md                  lo que exporta `mongozod/mzod`
```

La referencia de la API se escribe a mano, una página por entry point, y la de cada plugin oficial
va en su página. TypeDoc imprimiría las firmas genéricas internas, como `Check<S, X>`, que no dicen
qué se pasa ni qué vuelve.

## README

Como el de [Zod](https://github.com/colinhacks/zod): el nombre, una línea que dice qué es y que es
la alternativa a Mongoose, «by [@tserdeiro](https://x.com/tserdeiro)», los badges y los links a los
docs y a la guía de Mongoose; el aviso de marca; «What is mongozod?», «Why not Mongoose?» (una
tabla corta, con fuentes), «Installation» (`npm install mongozod`, con los peers explicados aparte: npm y pnpm los instalan si faltan; y que la API puede cambiar en la 0.x), «Basic usage»
(definir un modelo, leer y escribir, aceptar consultas de clientes), «Documentation» y «License».
Los links son absolutos: el mismo archivo se muestra en la raíz de GitHub, por el symlink, y en
`packages/mongozod` en npm, así que uno relativo apuntaría a lugares distintos. Llevan a mongozod.dev.

## Marca

El README, la primera página y el pie del sitio dicen que mongozod es un proyecto independiente, no
afiliado, avalado ni patrocinado por MongoDB, Inc., y escriben MongoDB® con el aviso de marca
registrada, como piden las
[Trademark Standards](https://www.mongodb.com/legal/trademark-usage-guidelines) (norma 3) para no
dar a entender, «directly or by omission», que es de MongoDB. Las normas 2 y 6 tampoco admiten
combinar «Mongo» con otra palabra en un nombre o un dominio: el nombre se mantiene con el aviso,
sabiendo que la norma 7 les permite objetar (decidido el 2026-10-12).

## Agentes

- **Las docs instaladas**: `node_modules/mongozod/dist/docs/`, con su `README.md` como índice.
- **`AGENTS.md`**: el README y la página «AI agents» muestran un bloque para pegar, entre los
  marcadores `<!-- BEGIN:mongozod-agent-rules -->` y `<!-- END:mongozod-agent-rules -->`, como el
  de Next.js, que lleva al agente a las docs instaladas. No hay un comando que lo escriba: si se
  pide, se suma después.
- **El sitio**: cada página también en Markdown, en su URL con `.md` y en la misma URL con
  `Accept: text/markdown`; `/llms.txt` y `/llms-full.txt`, del [estándar](https://llmstxt.org/);
  los botones «Copy Markdown» y «Open in ChatGPT/Claude»; y un `robots.txt` abierto. Fumadocs trae
  todo eso ([LLMs](https://www.fumadocs.dev/docs/integrations/llms)).
- **Skills**: solo `skills/migrate-from-mongoose/`, con el texto del «Copy prompt» de la guía. El
  conocimiento va en las docs, que el agente tiene siempre: Next.js midió que rinden más que las
  skills ([evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)), y deja
  las skills para los flujos de trabajo. La skill y el prompt tienen un paso para conservar la
  seguridad de cada llamada: parsear el input de cada endpoint antes del modelo, que no sanitiza
  como el `sanitizeFilter` de Mongoose, y conservar con `$and` las condiciones de dueño o tenant.
- **JSDoc**: cada export público lleva el link a su página.

## Sitio

`apps/website`, con Next.js 16 y Fumadocs 16, como zod.dev: una landing y `/docs`, que lee
`@repo/docs`. Parte de la plantilla de `create-fumadocs-app` (Next.js con Fumadocs MDX), que ya trae
las rutas para agentes.

- **Contenido**: `defineDocs` de `fumadocs-mdx/macro` con `dir: '../../packages/docs'`, sin el
  `README.md`, que es el índice de GitHub. Fumadocs MDX compila cada `.md` como Markdown y no como
  MDX (lo elige por la extensión, verificado en su código), así que un `<` o un `{` del texto no
  rompe nada. Los links relativos entre archivos funcionan con `createRelativeLink`.
- **Alertas**: un plugin de remark propio (`lib/remark-github-alerts.ts`) convierte cada
  `> [!NOTE]` en el `Callout` de Fumadocs, que no las reconoce solo.
- **Para agentes**: cada página en `/docs/<página>.md` y en la misma URL con
  `Accept: text/markdown` (el `proxy.ts` de la plantilla, con `Vary: Accept`), con un `<link
  rel="alternate" type="text/markdown">` en el HTML. Lo que se sirve es el archivo tal como está
  escrito, con su título, su descripción y los links relativos convertidos en URLs absolutas de sus
  `.md`, para que un agente que bajó una página pueda seguirlos. `/llms.txt` sigue el
  [estándar](https://llmstxt.org/): el nombre, un resumen, cómo instalarlo, dónde están las docs en
  `node_modules`, el aviso de marca y una sección por carpeta con el link al `.md` de cada página.
  `/llms-full.txt` junta todas.
- **Además**: el aviso de marca al pie de cada página, `robots.txt` abierto, `sitemap.xml` e
  imágenes de Open Graph por página.

Publica la versión que está en npm, no la de `main`; cómo, se decide al desplegarlo. El playground
sigue en la fase 7 del [Roadmap](./roadmap.md).

## Orden

1. Esta propuesta (hecho).
2. `packages/docs`, la copia al paquete y `pnpm check-docs` (hecho).
3. El README (hecho).
4. Las páginas (hecho): primero `getting-started/` y `mongoose/`, que la fase 6 pide antes de la
   0.x; después `guides/`, `plugins/`, `recipes/` y `api/`. Las escribieron agentes en paralelo
   con las reglas de [Redacción](#redacción), cada uno verificando sus afirmaciones contra el código
   y MongoDB, y otros dos las revisaron buscando contradicciones entre páginas.
5. La skill de migración (hecho).
6. `apps/website` (hecho).

El sitio está en Vercel, en mongozod.dev, desde el 2026-10-12, y el README y los JSDoc llevan a sus
páginas: cada export público tiene un `@see` a su entrada de la referencia. Queda decidir cómo
publica la versión de npm y no la de `main`: por defecto, Vercel despliega cada push a `main`.

Un cambio de la API pública actualiza su página en el mismo commit (ver `AGENTS.md`).
