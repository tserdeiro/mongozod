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

## Checklist

### A. Técnico

Un commit por punto, `feat(website): …`, cada uno verificado con `pnpm build` y el HTML que genera.

- [ ] **Canonical**: `alternates.canonical` en la home (`/`) y en cada página de docs (`page.url`).
- [ ] **Canonical del Markdown**: el route de `llms.mdx` responde con
      `Link: <https://mongozod.dev/docs/<página>>; rel="canonical"`, así el `.md` no compite con la
      página en los buscadores y los agentes lo siguen leyendo igual.
- [ ] **Open Graph de la home**: `opengraph-image` en `app/(home)` con `generateOGImage` de
      Fumadocs, como las páginas de docs, y `openGraph` con `siteName`, `url` y `type`. Como la
      metadata de las páginas reemplaza el `openGraph` del layout, los campos comunes van en una
      constante de `lib/shared.ts`.
- [ ] **JSON-LD de la home**: `WebSite` y
      [`SoftwareSourceCode`](https://schema.org/SoftwareSourceCode) con el nombre, la descripción,
      `codeRepository`, `programmingLanguage` (TypeScript), `runtimePlatform` (Node.js), `license`
      (Apache-2.0) y el autor.
- [ ] **JSON-LD de las docs**: `TechArticle` (título, descripción, URL, `dateModified`) y
      `BreadcrumbList` con las carpetas del sidebar.
- [ ] **Fechas**: `lastModified: true` en `defineDocs`, y la fecha en el `lastModified` del sitemap,
      en el `dateModified` del JSON-LD y visible al pie de cada página.
- [ ] **Validar**: cada tipo de página en el
      [Rich Results Test](https://search.google.com/test/rich-results) y el
      [Schema Markup Validator](https://validator.schema.org/).
- [ ] **Registrar** las decisiones en [Documentación](./documentation.md#sitio).

### B. Contenido

Cada punto se decide antes de escribirlo, con las reglas de [Redacción](./documentation.md) y sin
plantear una sección como una falla de mongozod.

- [x] **Qué destacar**: ver [arriba](#qué-destacar).
- [ ] **Benchmark**: decidir si se publica uno reproducible contra Mongoose, con y sin `lean()`,
      para dar números del punto 4.
- [ ] **React Native en las docs**: sumarlo a lo que dice
      [Installation](../../packages/docs/getting-started/installation.md) de `mongozod/mzod`, que
      hoy nombra solo los navegadores.
- [ ] **Las preguntas**: la lista de lo que alguien le pregunta a un LLM y debería traer a mongozod,
      como «Mongoose alternative with Zod», «validate MongoDB documents with Zod», «type-safe
      MongoDB queries in TypeScript» o «Zod schema for a MongoDB collection», y qué página responde
      cada una.
- [ ] **El primer párrafo**: que el de las páginas que responden esas preguntas diga la respuesta
      de entrada, y que su `description` la resuma.
- [x] **Otras librerías**: investigadas, ver [Comparaciones](#comparaciones).
- [ ] **Escribir las comparaciones** en Why MongoZod, como se acordó.
- [x] **Motivación**: como la de [Typegoose](https://github.com/typegoose/typegoose#motivation), el
      problema de los tres schemas y el código de antes y después, en el README y al principio de Why
      MongoZod. Acordado el 2026-11-03.
- [ ] **FAQ**: decidir si va una página de preguntas frecuentes o si cada respuesta vive en su
      página.

### C. Fuera del sitio

Lo hace el maintainer, salvo el `package.json`.

- [ ] **Google Search Console**: verificar el dominio y enviar el sitemap.
- [ ] **Bing Webmaster Tools**: importar el sitio desde Search Console y enviar el sitemap.
- [ ] **IndexNow**: decidir si se avisa en cada despliegue o si alcanza con el sitemap.
- [ ] **npm**: `homepage` a `https://mongozod.dev` y `keywords` con `mongoose`, `odm` y
      `mongoose-alternative`, con su changeset.
- [ ] **Menciones**: proponer mongozod en la página de ecosistema de Zod y en las listas de
      MongoDB y TypeScript, si el maintainer quiere.

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

- Que el build de Vercel tenga la historia de Git que pide `lastModified`. Si clona con poca
  profundidad, las fechas salen mal o no salen, y hay que resolverlo antes de mostrarlas.
- Cómo muestra la fecha la interfaz de Fumadocs (`PageLastUpdate` o equivalente) en la versión
  instalada.
