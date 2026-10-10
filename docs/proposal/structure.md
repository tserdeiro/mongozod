# Estructura del repo

| Carpeta o archivo     | Contenido                                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/mongozod/`  | El paquete `mongozod`. Los plugins oficiales son subpaths del paquete, como `mongozod/plugins/soft-delete`, así que se instala un solo paquete, con una sola versión. Un plugin pasa a ser un paquete aparte, en `packages/`, solo si necesita una dependencia propia. |
| `examples/<ejemplo>/` | Los ejemplos de uso, como `nextjs`, `tanstack-start` y `tanstack-router-trpc`.                                                                                                                                                                                         |
| `docs/`               | La documentación, que se lee en GitHub y en el sitio, con una copia en `.md` para agentes. `proposal/` es esta propuesta.                                                                                                                                              |
| `skills/`             | Las skills para agentes.                                                                                                                                                                                                                                               |
| `AGENTS.md`           | Las instrucciones para los agentes que trabajan en el repo.                                                                                                                                                                                                            |
| `README.md`           | La presentación del proyecto.                                                                                                                                                                                                                                          |
| `LICENSE`             | La licencia.                                                                                                                                                                                                                                                           |

## Convenciones

- **Idioma**: la propuesta está en español. El README, la documentación para usuarios, `AGENTS.md`,
  las skills y los JSDoc van en inglés.
- **Referencias**: los documentos se citan entre sí con links relativos, como
  `[Tipos](./types.md)`.

## Por definir

- **Sitio**: dónde vive depende del framework. Si es una app aparte, iría en `apps/website`:
  [Turborepo](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)
  recomienda `apps/` para las aplicaciones y `packages/` para las librerías. Vitest, en cambio,
  tiene su sitio de VitePress dentro de `docs/`.
- **Formato de los docs**: la propuesta es Markdown plano, sin MDX, para que se vea igual en GitHub
  y en el sitio. Así trabaja TanStack: cada librería tiene sus docs en `.md` en su repo, y
  tanstack.com sirve cada página también como `.md`.
- **Agentes**: cómo llegan a los docs de la versión instalada.
  [Next.js](https://nextjs.org/docs/app/guides/ai-agents) incluye sus docs en el paquete, y un
  bloque de `AGENTS.md` lleva ahí a los agentes. [TanStack Intent](https://tanstack.com/intent/latest),
  en alpha, publica las skills dentro del paquete. `npx skills add`
  ([skills CLI](https://github.com/vercel-labs/skills)) busca `skills/` en la raíz del repo, pero
  instala lo que hay en el repo, no la versión instalada.
- **Licencia**: el repo trae Apache 2.0.
