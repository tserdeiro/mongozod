# Ejemplos

Aplicaciones completas que muestran mongozod de punta a punta, del cliente al servidor, como los
[ejemplos de TanStack](https://tanstack.com/router/latest/docs/framework/react/examples/quickstart-file-based):
el mismo schema de Zod valida el formulario, el endpoint y lo que genera una IA, y define el
documento que se guarda. Acordado con el maintainer el 2026-10-26.

## Los ejemplos

| Ejemplo                | Stack                                                      |
| ---------------------- | ---------------------------------------------------------- |
| `nextjs`               | Next.js con App Router, Server Components y Server Actions |
| `nextjs-ai-sdk`        | Next.js con el [AI SDK](https://ai-sdk.dev)                |
| `tanstack-start`       | TanStack Start, con server functions                       |
| `tanstack-start-ai`    | TanStack Start con [TanStack AI](https://tanstack.com/ai)  |
| `tanstack-router-trpc` | Una SPA con TanStack Router y Vite, y un servidor tRPC     |

`nextjs-ai-sdk` y `tanstack-start-ai` hacen lo mismo con dos stacks, para que quien lee los compare.
Se empieza por `nextjs`, que fija el dominio, el schema y el README, y después siguen los otros
cuatro.

No se despliegan: no hay demos ni grabaciones. Cada ejemplo se corre en local siguiendo su README
(ver [Cómo se comprueban](#cómo-se-comprueban)). Una demo pública pedía una base, un dominio y una
key de IA por ejemplo, y decidir qué hacer con lo que guardan los visitantes, que los demás verían;
una grabación queda vieja con el primer cambio de la UI. Lo que vale de un ejemplo de una librería
de base de datos es el código.

## El dominio: recetas

Los cinco ejemplos son la misma aplicación de recetas, para que se puedan comparar. Una receta se
crea de dos formas:

- **Con un formulario**: el schema valida el formulario en el cliente y el endpoint en el servidor.
- **Con IA**: quien usa la app describe un plato o pega una receta, el modelo genera el JSON con el
  mismo schema, el JSON llena el formulario mientras llega, y se revisa y se guarda como cualquier
  otra.

Las recetas se listan con filtros en la URL (`mz.filter`: `minutes` con `$lte`, `difficulty` con
`$eq`, `tags` con `$in`), con `mz.sort` y con `mz.after`, como en la receta
[HTTP APIs](../../packages/docs/recipes/http-apis.md), y cada una tiene su página en
`/recipes/<id>`, que valida el id con `mz.objectId()`.

### Un solo schema

El schema de la receta es el del modelo, y el mismo objeto valida el formulario, el endpoint y la
salida de la IA:

```ts
export const recipeSchema = z.object({

  title: z.string()
    .min(1)
    .meta({ description: 'The name of the dish' }),

  servings: z.number()
    .int()
    .positive(),

  minutes: z.number()
    .int()
    .positive()
    .meta({ description: 'Total time, preparation included' }),

  difficulty: z.enum(['easy', 'medium', 'hard']),

  tags: z.string()
    .array(),

  ingredients: z.object({

      name: z.string(),

      quantity: z.number()
        .positive(),

      unit: z.enum(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'unit'])
    })
    .array()
    .min(1),

  steps: z.string()
    .array()
    .min(1)
})

export const RecipesModel = mongozod({

  collection: 'recipes',

  db,

  schema: recipeSchema
})
```

- **Sin `_id` en el schema**: el driver genera un `ObjectId`, y las lecturas y los filtros lo tipan
  igual (ver [Schemas](../../packages/docs/guides/schemas.md#the-_id)). La IA nunca ve el `_id`.
- **Sin `timestamps`**: las más recientes se ordenan por `_id: -1`, porque un `ObjectId` empieza con
  el instante en que se creó, y `_id.getTimestamp()` da la fecha que se muestra.
- **Solo campos de JSON**: sin tipos de `mongozod/mzod`, sin `.default()` y sin opcionales, porque el
  AI SDK y TanStack AI convierten el schema a JSON Schema para el proveedor. Los `description` de
  `.meta()` le llegan al modelo y sirven de ayuda en el formulario.
- **El `_id` viaja como string**: lo que se manda al cliente lleva `_id.toHexString()`, porque un
  `ObjectId` no cruza el límite de una server function de Start ni de tRPC.

Por qué no un `_id` con uuid ni `timestamps`, comprobado con `z.toJSONSchema` (`io: 'input'`, Zod
4.6.5):

- `mz.uuid()` y `mz.objectId()` fallan: «Custom types cannot be represented in JSON Schema».
- `mz.date()` y `z.date()` fallan: «Date cannot be represented in JSON Schema». `timestamps` pide
  declarar `createdAt` y `updatedAt` como `Date` en el schema.
- `z.uuidv4().default(() => crypto.randomUUID())` convierte, pero Zod corre el `.default()` al
  convertir y deja un UUID fijo en el `default` del JSON Schema: el modelo puede copiarlo, y dos
  recetas generadas chocarían por el `_id`.

Se descartó un schema derivado para la IA (`recipeSchema.extend({ _id, createdAt, updatedAt })`
como documento): el modelo usaría otro schema, y el ejemplo dejaría de mostrar uno solo.

## Qué muestra cada uno

| Ejemplo                | Lo que enseña                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextjs`               | Las lecturas tipadas en Server Components, el alta en una Server Action que valida con `recipeSchema`, y la lista con los filtros en la URL.                                          |
| `nextjs-ai-sdk`        | La IA genera la receta con `streamText({ output: Output.object({ schema: recipeSchema }) })`, y `useObject` llena el formulario mientras llega. Se guarda con la misma Server Action. |
| `tanstack-start`       | Las server functions con `recipeSchema` como validador de entrada, y los filtros de la lista en `validateSearch`.                                                                     |
| `tanstack-start-ai`    | La IA genera la receta con `chat({ outputSchema: recipeSchema })`, y `useChat({ outputSchema })` llena el formulario con `partial` y lo completa con `final`.                         |
| `tanstack-router-trpc` | Cliente y servidor separados: procedimientos con `.input(recipeSchema)` y con los inputs de `mz` para la lista, la carga previa en los loaders del router, y el servidor tRPC aparte. |

## La key de la IA

Cada ejemplo de IA lee la key del proveedor de su `.env`, sin una UI para cargarla: el código queda
en mongozod, no en el manejo de keys.

- **`tanstack-start-ai`**: OpenRouter, que la documentación de TanStack AI recomienda como primera
  opción: una key para cientos de modelos.
- **`nextjs-ai-sdk`**: AI Gateway, también una key para muchos modelos.

## La UI

[shadcn/ui](https://ui.shadcn.com) en los cinco:

- **Cada ejemplo tiene su `components/ui`**: shadcn copia el código de los componentes al proyecto,
  así cada ejemplo se copia solo. No hay un paquete de UI compartido.
- **Formularios**: las dos integraciones que documenta shadcn, una por stack.
  [React Hook Form](https://ui.shadcn.com/docs/forms/react-hook-form) con `zodResolver` en los de
  Next.js, y [TanStack Form](https://ui.shadcn.com/docs/forms/tanstack-form), que toma el schema de
  Zod por Standard Schema, en los de TanStack.
- **La UI de IA**: AI Elements, el kit de shadcn para chats, como el campo del prompt.

## En el repo

```
examples/
├── nextjs/
├── nextjs-ai-sdk/
├── tanstack-start/
├── tanstack-start-ai/
└── tanstack-router-trpc/
```

- **Cada ejemplo es una app que se copia sola**, como los de TanStack: su `package.json`, su
  `README.md`, un `.env.example` con `MONGODB_URI` y un `seed` que carga recetas. Los modelos se
  repiten en cada uno, sin un paquete compartido.
- **En el workspace**: `pnpm-workspace.yaml` ya incluye `examples/*`, así que Turborepo les corre
  `build` y `check-types`, y el CI los compila contra el paquete de `main`, como tests de integración
  con cuatro frameworks. Las reglas de React de oxlint, que [Estructura del repo](./structure.md)
  dejó para los ejemplos, entran con el primero.

## El README de cada ejemplo

Explica el ejemplo y cómo correrlo, y GitHub lo muestra al abrir su carpeta:

1. Qué muestra, en dos o tres líneas, y qué archivos leer primero: dónde está `recipeSchema` y
   dónde lo usan el formulario, el endpoint y la IA.
2. Lo que pide: Node.js, pnpm y un MongoDB, con el `docker run` de la imagen oficial o una URI de
   Atlas.
3. Cómo copiar el ejemplo fuera del repo.
4. El `.env`: `MONGODB_URI` y, en los de IA, la key del proveedor.
5. `pnpm install`, `pnpm seed` y `pnpm dev`.

## Cómo se comprueban

- **El CI** compila cada ejemplo (`build` y `check-types`) contra el paquete de `main`.
- **A mano, antes de mergear un ejemplo o un cambio en él**: se sigue su README al pie de la letra,
  como quien lo acaba de copiar, sin atajos del monorepo, y se revisa en el navegador que el
  formulario, la lista con sus filtros y el flujo de IA funcionen y se vean bien.

## En los docs

Una página, `packages/docs/getting-started/examples.md`, lista los cinco ejemplos, con una línea cada
uno y el link a su carpeta en GitHub, donde se lee el README. Así se encuentran desde mongozod.dev,
y a un agente le llega con el paquete. Los links son absolutos, a
`https://github.com/tserdeiro/mongozod/tree/main/examples/<ejemplo>`: la carpeta `examples/` no
viaja en el paquete. Sin explorador del código ni StackBlitz.

## Por verificar

Antes de escribirlo como decidido, cada punto se comprueba en la documentación o en un prototipo:

- **La versión de `mongozod` en los ejemplos**: declarar la publicada (`"mongozod": "0.4.0"`) con
  `linkWorkspacePackages` de pnpm, para que en el repo se enlace al paquete local y copiado se
  instale de npm, y que Changesets la suba en cada release.
- **El modo estricto de los proveedores**: si exige que todos los campos sean obligatorios, y cómo
  lo convierten el AI SDK y TanStack AI.
- **AI Elements**: sus integraciones con el AI SDK y con TanStack AI.
