# SEO y GEO del sitio

Cómo [mongozod.dev](https://mongozod.dev) se encuentra en los buscadores (SEO) y se cita en las
respuestas de los motores de IA, como ChatGPT, Claude, Perplexity y los AI Overviews de Google
(GEO). Estado: plan, pendiente de acordar con el maintainer punto por punto.

## Punto de partida

El sitio ya tiene lo que leen los agentes (ver [Documentación](./documentation.md#sitio)): cada
página en `.md` y con `Accept: text/markdown`, el `<link rel="alternate" type="text/markdown">`,
`/llms.txt` y `/llms-full.txt`, un `robots.txt` abierto, `sitemap.xml` e imágenes de Open Graph por
página de docs.

Revisado contra el sitio publicado el 2026-11-03, falta:

- `<link rel="canonical">`, en la home y en las páginas.
- Open Graph y la tarjeta de X en la home, que solo tiene `description`.
- Datos estructurados: no hay ningún JSON-LD.
- Fechas: el sitemap no tiene `lastModified` y las páginas no dicen cuándo cambiaron.
- En npm, `homepage` lleva al README de GitHub y no al sitio.

## Qué dicen las fuentes

- **Google**: los AI Overviews y AI Mode no piden nada aparte del SEO de siempre, ni datos
  estructurados especiales ni archivos para IA como `llms.txt`
  ([AI features](https://developers.google.com/search/docs/appearance/ai-features)). Recomienda
  rastreo abierto, links internos, el contenido como texto, datos estructurados que coincidan con
  el texto visible y verificar el sitio en Search Console.
- **Canonical por header**: Google acepta `Link: <url>; rel="canonical"` en la respuesta HTTP,
  también para documentos que no son HTML
  ([consolidar URLs duplicadas](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)).
- **ChatGPT**: aparece en su búsqueda lo que deja rastrear a `OAI-SearchBot`
  ([bots de OpenAI](https://developers.openai.com/api/docs/bots)). El `robots.txt` abierto ya lo
  permite.
- **Bing**: [IndexNow](https://www.bing.com/indexnow/getstarted) avisa a los buscadores de las URLs
  que cambiaron, con una key en un archivo del sitio y un `POST` a `api.indexnow.org/IndexNow`.
- **Next.js**: el JSON-LD va en un `<script type="application/ld+json">` del `page` o el `layout`,
  con los `<` escapados como `<` ([guía](https://nextjs.org/docs/app/guides/json-ld));
  el canonical sale de `alternates.canonical`; y la metadata de cada segmento reemplaza los campos
  anidados del anterior, como `openGraph`, en lugar de mezclarlos.
- **Fumadocs MDX**: `defineDocs` acepta `lastModified: true`, que toma la fecha del último commit de
  cada archivo con `git log`.

Por eso la parte técnica sirve para los dos: lo que ayuda a Google y a Bing ayuda a los motores que
buscan en ellos. Lo que más pesa en GEO es el contenido: páginas que respondan de entrada lo que
alguien le pregunta a un LLM.

## Qué destacar

Acordado con el maintainer el 2026-11-03, en este orden. Cada punto lleva a la página que lo
respalda.

1. **Un solo schema**: el de Zod valida las escrituras, tipa las lecturas y define los inputs de los
   endpoints. No hay un schema de Mongoose, un tipo de TypeScript y un schema de Zod que se
   desincronizan ([Why MongoZod](../../packages/docs/getting-started/why-mongozod.md)).
2. **Tipos estrictos en cada query**: filtros, updates, proyecciones y sorts chequeados contra el
   schema, con paths con punto, y una proyección que achica el resultado. Sin clases, decoradores
   ni `reflect-metadata`, como pide [Typegoose](https://typegoose.github.io/typegoose/), y sin los
   límites de la inferencia de Mongoose, que pide el schema en línea y deja las interfaces como
   alternativa ([TypeScript de Mongoose](https://mongoosejs.com/docs/typescript/schemas.html)).
3. **Valida cada update**: todos los operadores, con refinements, y el documento que insertaría un
   upsert. En Mongoose la validación de updates viene apagada y cubre seis operadores.
4. **Una capa fina sobre el driver oficial**: sus nombres, opciones y resultados, sin dependencias
   propias. Las lecturas devuelven los objetos planos del driver, sin hidratar documentos, que
   según Mongoose ocupan unas 3 veces más memoria
   ([lean](https://mongoosejs.com/docs/tutorials/lean.html)).
5. **Inputs de endpoints**: `mz` acepta sintaxis de MongoDB de los clientes, limitada a lo que
   declara cada endpoint, y cierra la inyección de operadores.
6. **Validación de punta a punta**: el mismo schema valida el formulario en el cliente y la
   escritura en el servidor. El modelo corre en Node.js y Bun; el cliente importa solo los schemas
   y `mongozod/mzod`, que no importa el driver y corre en navegadores y en React Native.
7. **Pensado para agentes de IA**: las docs en el paquete, a la versión instalada, como recomienda
   [Next.js](https://nextjs.org/docs/app/guides/ai-agents); `npx mongozod agents-md`; cada página
   en Markdown y `llms.txt`; y la skill de migración desde Mongoose.
8. **Plugins**: el contrato de [better-auth](https://www.better-auth.com), con hooks por operación o
   por grupo ([Writing plugins](../../packages/docs/plugins/writing-plugins.md)).
9. **Migrar de Mongoose de a un modelo**: comparten la conexión, con la guía, el cheatsheet y la
   skill.
10. **Issues abiertos de Mongoose resueltos**: discriminators de varios niveles, `populate` tipado,
    upserts con campos requeridos.
11. **El costo de los tipos con presupuesto en CI**, para que un release no vuelva lento el editor.

## Comparaciones

[Why MongoZod](../../packages/docs/getting-started/why-mongozod.md) compara con Mongoose y con el
driver y Zod a mano. Las demás librerías que se usan con MongoDB y TypeScript, revisadas el
2026-11-03 en su documentación, con las descargas semanales de npm de esa semana:

| Librería                                                                              | Descargas | Qué es, según sus docs                                                                                                            |
| ------------------------------------------------------------------------------------- | --------: | --------------------------------------------------------------------------------------------------------------------------------- |
| [Typegoose](https://typegoose.github.io/typegoose/docs/guides/motivation)             |   297.267 | Modelos de Mongoose como clases con decoradores y `reflect-metadata`, para no definir el modelo y la interfaz por separado.       |
| [Prisma](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/mongodb) |         — | Prisma ORM 7 todavía no soporta MongoDB; para MongoDB recomienda la 6.19. Usa su propio lenguaje de schema y un cliente generado. |
| [TypeORM](https://typeorm.io/docs/drivers/mongodb)                                    |         — | Soporte «básico» de MongoDB; la mayoría de sus funciones son de bases relacionales. Entidades con decoradores.                    |
| [MikroORM](https://mikro-orm.io/docs/usage-with-mongo)                                |    49.283 | `@mikro-orm/mongodb`: entidades con decoradores y unit of work.                                                                   |
| [Papr](https://github.com/plexinc/papr)                                               |    12.781 | Una capa fina sobre el driver, con helpers de schema propios; valida las escrituras con el `$jsonSchema` de MongoDB, en la base.  |
| [@nullix/zod-mongoose](https://www.npmjs.com/package/@nullix/zod-mongoose)            |    20.688 | Escribe schemas de Mongoose con Zod; Mongoose sigue debajo.                                                                       |

Prisma y TypeORM no tienen descargas propias de MongoDB: las de su paquete son de todas las bases.

Acordado con el maintainer el 2026-11-03:

- **Typegoose**, dentro de la comparación con Mongoose: una fila o un párrafo, con el link.
- **Una sección «Compared with other libraries»** en Why MongoZod, con una línea por librería: qué
  elige mongozod frente a cada una, sin plantearlo como una falla de ninguna. Papr, la más
  parecida, marca la diferencia principal: la validación en la aplicación con Zod, refinements
  incluidos, y el `$jsonSchema` en la base como opción de `sync()`.
- **Sin páginas «mongozod vs X»** por ahora: solo Mongoose tiene volumen para una, y ya tiene su
  carpeta, [Desde Mongoose](../../packages/docs/mongoose/index.md). Cada fecha y número se revisa al
  escribir la sección.

## Las preguntas

Lo que alguien le pregunta a un LLM y debería traer a mongozod, y la página que lo responde.
Acordado con el maintainer el 2026-11-03. Van en inglés, como las escribe la mayoría y como están
las docs. Las que dicen «falta» no tienen página todavía.

| Pregunta                                                         | Página                                       |
| ---------------------------------------------------------------- | -------------------------------------------- |
| **Alternativas y comparaciones**                                 |                                              |
| What's a good Mongoose alternative for TypeScript?               | Why MongoZod                                 |
| Mongoose alternative with Zod                                    | Why MongoZod                                 |
| Is there a MongoDB ODM that uses Zod schemas?                    | Introduction                                 |
| MongoZod vs Mongoose                                             | Why MongoZod                                 |
| Do I need Typegoose to type Mongoose models?                     | Why MongoZod, la fila «Document type»        |
| Prisma 7 doesn't support MongoDB: what can I use?                | Why MongoZod, otras librerías                |
| Lightweight TypeScript library on the official MongoDB driver    | Why MongoZod (Papr), Introduction            |
| **Zod con MongoDB**                                              |                                              |
| How do I use Zod with MongoDB?                                   | Quick start                                  |
| How do I validate MongoDB documents with Zod?                    | Validation                                   |
| How do I validate MongoDB updates and upserts with Zod?          | Validation                                   |
| One schema for MongoDB, TypeScript and the API                   | Why MongoZod (la motivación), Schemas        |
| Zod schema for ObjectId, Decimal128 or GeoJSON                   | BSON types                                   |
| Generate a MongoDB `$jsonSchema` validator from Zod              | Sync                                         |
| **TypeScript**                                                   |                                              |
| Type-safe MongoDB queries in TypeScript                          | TypeScript                                   |
| How do I type MongoDB projections and dotted paths?              | TypeScript                                   |
| Typed populate for MongoDB                                       | Populate                                     |
| Discriminated unions in one MongoDB collection                   | Document types                               |
| **APIs y seguridad**                                             |                                              |
| How do I accept MongoDB filters from a client safely?            | Endpoint inputs, Security                    |
| How do I prevent NoSQL operator injection in Node.js?            | Security                                     |
| Keyset or cursor pagination in MongoDB with TypeScript           | Pagination                                   |
| Validate a form on the client and the server with one Zod schema | Falta: las páginas por framework             |
| **Migrar de Mongoose**                                           |                                              |
| How do I migrate from Mongoose?                                  | Migrating from Mongoose                      |
| Mongoose populate, virtuals or timestamps equivalent             | Cheatsheet                                   |
| Mongoose soft delete plugin alternative                          | Soft delete                                  |
| **Frameworks**                                                   |                                              |
| MongoDB with Zod in Next.js                                      | Falta: su página, al terminar el ejemplo     |
| MongoDB with Zod in TanStack Start                               | Falta: su página, al terminar el ejemplo     |
| MongoDB with Zod and tRPC                                        | Falta: su página, al terminar el ejemplo     |
| **Agentes de IA y performance**                                  |                                              |
| Which MongoDB library works well with AI coding agents?          | AI agents                                    |
| Is Mongoose slow? / Lightweight alternative to Mongoose          | Falta: depende del benchmark                 |
| Mongoose vs the native MongoDB driver                            | Falta: un párrafo en Why MongoZod, a decidir |

La de Prisma se responde como «qué usar para MongoDB», no como un juicio sobre Prisma. La lista
también sirve para medir: son las preguntas que se les hacen a los motores de IA (ver
[D](#d-medición)).

## Checklist

### A. Técnico

Un commit por punto, `feat(website): …`, cada uno verificado con `pnpm build` y el HTML que genera.

- [x] **Canonical**: `alternates.canonical` en la home (`/`) y en cada página de docs (`page.url`).
- [x] **Canonical del Markdown**: el route de `llms.mdx` responde con
      `Link: <https://mongozod.dev/docs/<página>>; rel="canonical"`, así el `.md` no compite con la
      página en los buscadores y los agentes lo siguen leyendo igual.
- [x] **Open Graph de la home**: `opengraph-image` en `app/(home)` con `generateOGImage` de
      Fumadocs, como las páginas de docs, con la primera oración de la descripción, la única que
      entra bajo el título. La home y las páginas de docs declaran `siteName`, `url` y `type`
      (`website` y `article`) cada una, porque la metadata de una página reemplaza el `openGraph`
      del layout.
- [x] **JSON-LD de la home**: `WebSite` y
      [`SoftwareSourceCode`](https://schema.org/SoftwareSourceCode) con el nombre, la descripción,
      `codeRepository`, `programmingLanguage` (TypeScript), `runtimePlatform` (Node.js), `license`
      (Apache-2.0), el autor como en el pie (`tserdeiro`) y `sameAs` con GitHub y npm. Tipado con
      [`schema-dts`](https://www.npmjs.com/package/schema-dts), como sugiere Next.js.
- [x] **JSON-LD de las docs**: `TechArticle` (título, descripción, URL, `dateModified`), parte del
      sitio y sobre la librería por su `@id`, y `BreadcrumbList` desde «Docs» con las carpetas del
      sidebar que tienen página.
- [x] **Fechas**: `lastModified: true` en `defineDocs`, y la fecha en el `lastModified` del sitemap,
      en el `dateModified` del JSON-LD y al pie de cada página con `PageLastUpdate`. Vercel clona
      con `--depth=10` ([Builds](https://vercel.com/docs/builds/configure-a-build)), así que el build
      del sitio corre `scripts/unshallow.ts`, que trae la historia completa si el clone es
      superficial. Probado con un clone de profundidad 10: una página sin cambios en los últimos 10
      commits tomaba la fecha del más viejo, y con el script toma la suya.
- [ ] **Validar**: cada tipo de página en el
      [Rich Results Test](https://search.google.com/test/rich-results) y el
      [Schema Markup Validator](https://validator.schema.org/), cuando esté desplegado.
- [x] **Registrar** las decisiones en [Documentación](./documentation.md#sitio).

### B. Contenido

Cada punto se decide antes de escribirlo, con las reglas de [Redacción](./documentation.md) y sin
plantear una sección como una falla de mongozod.

- [x] **Qué destacar**: ver [arriba](#qué-destacar).
- [ ] **Benchmark**: decidir si se publica uno reproducible contra Mongoose, con y sin `lean()`,
      para dar números del punto 4.
- [x] **React Native en las docs**: en
      [Installation](../../packages/docs/getting-started/installation.md) y el README, junto a los
      navegadores; la referencia de `mongozod/mzod` ya lo decía.
- [x] **Las preguntas**: ver [Las preguntas](#las-preguntas).
- [x] **El primer párrafo**: el de las páginas que responden esas preguntas dice la respuesta de
      entrada, con las palabras de la pregunta, y su `description` la resume: Introduction, Why
      MongoZod, Quick start, Validation, TypeScript, Endpoint inputs y Migrating from Mongoose, y la
      `description` de Schemas, BSON types, Sync, Populate, Document types, Security, Pagination,
      Cheatsheet, Soft delete y AI agents. Una `description` no lleva `: `, que rompe su YAML.
- [ ] **Mongoose y el driver**: decidir si Why MongoZod suma un párrafo sobre Mongoose frente al
      driver nativo.
- [x] **Otras librerías**: investigadas, ver [Comparaciones](#comparaciones).
- [x] **Escribir las comparaciones** en Why MongoZod, como se acordó.
- [x] **Motivación**: como la de [Typegoose](https://github.com/typegoose/typegoose#motivation), el
      problema de los tres schemas y el código de antes y después, en el README y al principio de Why
      MongoZod. Acordado el 2026-11-03.
- [ ] **FAQ**: decidir si va una página de preguntas frecuentes o si cada respuesta vive en su
      página.

### C. Fuera del sitio

Lo hace el maintainer, salvo el `package.json`.

- [x] **Google Search Console**: el maintainer verificó el dominio el 2026-11-03.
- [ ] **Bing Webmaster Tools**: importar el sitio desde Search Console y enviar el sitemap.
- [x] **IndexNow**: acordado el 2026-11-03. El workflow `indexnow.yml` corre cuando un despliegue
      de producción de Vercel queda en `success`, compara su commit con el del despliegue anterior
      que salió bien y manda a `api.indexnow.org` las páginas de las docs que cambiaron y la home,
      con la key que el sitio sirve en `/<key>.txt`. Solo las que cambiaron, como pide su
      [FAQ](https://www.indexnow.org/faq): reenviar las mismas puede dar un 422, y el sitemap sigue
      siendo el inventario completo.
- [x] **npm**: `homepage` a `https://mongozod.dev`, y `keywords` con `mongoose`,
      `mongoose-alternative`, `odm`, `orm`, `bson`, `json-schema`, `nosql`, `type-safe` y las
      demás que listan Mongoose, Typegoose y Papr, con su changeset. Se ve en npm con la próxima
      versión.
- [x] **Ecosistema de Zod**: pedido en
      [colinhacks/zod#6723](https://github.com/colinhacks/zod/issues/6723), en «Powered by Zod», el
      2026-11-03. El repo ya no acepta PRs externas: desde septiembre las entradas se piden con un
      issue «Ecosystem: add X to Y» con la entrada sugerida.
- [ ] **Otras menciones**: las listas de MongoDB y TypeScript, si el maintainer quiere.

### D. Medición

- [ ] **Buscadores**: las consultas y las páginas indexadas en Search Console y en Bing Webmaster
      Tools.
- [ ] **Motores de IA**: las visitas que llegan desde `chatgpt.com`, `perplexity.ai` y similares,
      en los referidos de Google Analytics.
- [ ] **Citas**: hacer las preguntas de B en ChatGPT, Claude y Perplexity antes de empezar y cada
      tanto después, y anotar si citan a mongozod.

## Orden

1. A, en una PR, porque no depende de decisiones de contenido. C puede ir en paralelo.
2. B, empezando por la lista de preguntas.
3. D, con una primera medición antes de A, para comparar.
4. Al final, una página por framework, como «MongoDB with Zod in Next.js», a medida que se termina
   cada [ejemplo](./examples.md): lo que muestra, cómo se integra y el link a su código.

## Por verificar

- Que `git fetch --unshallow` funcione en el build de Vercel, en el primer despliegue: el log del
  build lo muestra, y el sitemap publicado tiene las fechas de `git log`.
