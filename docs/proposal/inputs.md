# Inputs de los endpoints

## Enfoque

Este enfoque reemplaza al `parser`. Cada endpoint declara, campo por campo, qué operadores de Mongo
acepta, y el cliente manda directamente la sintaxis de Mongo.

- **Validación**: el schema rechaza todo lo demás, como un `$where`, un operador o un campo no
  declarado. Cada valor se valida con el schema de su campo, así que una fecha que llega como ISO
  se convierte en `Date`.
- **Constructores**: uno por cada parte de una consulta:
  - **`mz.filter`**: los operadores que declara cada campo.
  - **`mz.update`**: los campos de cada operador. `$unset` solo admite campos opcionales y `$inc`,
    solo numéricos. No completa defaults: un update parcial no pisa `content` con `''`.
  - **`mz.sort`**: los campos declarados, con `1` o `-1`.
  - **`mz.projection`**: los campos declarados, sin mezclar inclusión y exclusión.
  - **`mz.cursor`**: la paginación por clave.
  - **`mz.populate`**: las referencias que el cliente puede expandir y los campos que puede ver.
- **Errores de tipos al declarar**: un `$regex` sobre una fecha, un `$unset` de un campo
  obligatorio, un `$inc` sobre un string o un campo que no existe no compilan.
- **Campos obligatorios**: `{ required: ['_id'] }` hace obligatorio el `_id` en un filtro, para que
  un `{}` no coincida con cualquier documento.

## Cómo se usa

El ejemplo usa `brands`, que hoy expande `organization`. El código compila en el prototipo:

```ts
// model.ts: organizations belong to Better Auth, so the reference names the collection and schema.

export const BrandsModel = mongozod({
  schema: brandSchema,
  collection: 'brands',
  db: () => db,
  plugins: [softDelete()],
  references: { organization: { collection: 'organizations', schema: organizationSchema } }
})
```

```ts
// schemas/validations.ts: client-safe, no model imported.

import { mz } from 'mongozod/mz'
import { z } from 'zod'

/** The project's own search, here MongoDB's text index. */
function textSearch(term?: string) {
  if (!term) return {}

  return { $text: { $search: term } }
}

export const listBrandsSchema = z.object({
  cursor: mz.cursor(brandSchema, { createdAt: -1, _id: -1 }),
  filter: mz.filter(brandSchema, {
    _id: ['$eq', '$in'],
    host: ['$eq'],
    name: ['$eq', '$exists']
  }),
  limit: z.number().int().min(1).max(100).default(20),
  populate: mz.populate({ organization: organizationSchema.pick({ _id: true, name: true }) }),
  term: z.string().optional().transform(textSearch)
})

export const findOneBrandSchema = z.object({
  filter: mz.filter(brandSchema, { _id: ['$eq'] }, { required: ['_id'] }),
  populate: mz.populate({ organization: organizationSchema.pick({ _id: true, name: true }) })
})
```

```ts
// router.ts: every input is already a filter, so there is nothing to fall back on.

export async function list(input: z.output<typeof listBrandsSchema>) {
  const filter = { $and: [input.filter, input.cursor, input.term, scope] }
  const list = await BrandsModel.find(filter, {
    limit: input.limit,
    populate: input.populate,
    sort: { createdAt: -1, _id: -1 }
  })

  return { list }
}
```

El cliente manda, por ejemplo,
`{ filter: { name: { $exists: true } }, populate: { organization: { name: 1 } } }`. Como `cursor`,
manda `{ createdAt, _id }` del último elemento de la página.

## Decisiones de los inputs

1. **`mz`.** `mongozod/mz` exporta `mz`, con los constructores: `mz.filter`,
   `mz.update`, `mz.sort`, `mz.projection`, `mz.cursor` y `mz.populate`.
   - **Junto a `z`**: no reexporta Zod, así que cada archivo conserva su `z` y suma un import, sin
     chocar. Cada constructor devuelve un schema de Zod que se anida en `z.object` como cualquier
     otro.
   - **Namespace**: no son funciones sueltas porque `filter`, `update` y `sort` chocan con nombres
     de variables comunes, como los `filter` y `update` de los routers de adsgpt. Además, con `mz`
     como único export, el editor agrega el import al escribir `mz` y no sugiere los constructores
     sueltos. Con funciones sueltas y `import * as mz`, como el `import * as z` de Zod, el editor no
     agrega ese import y sugiere `filter` cada vez que se escribe.
   - **Subpath**: `mongozod/mz`, igual que lo único que exporta. `/zod` hacía esperar un `z`, y
     `/inputs` no coincidía con `mz`. No importa el driver, así los schemas de validación siguen
     sirviendo en web y en native.
2. **Sin fallbacks en el router.** `mz.filter` y `mz.cursor` devuelven `{}` cuando el cliente no los
   manda, y el proyecto convierte el `term` en filtro dentro del schema. Así el router solo junta
   filtros con `$and`, sin `?? {}` ni `|| {}`. Un filtro con campos obligatorios no tiene default.
3. **`references` en el núcleo y `mz.populate`.** Con el contrato de plugins, un plugin no puede
   cambiar el tipo que devuelve `find`: haría falta un registro de tipos por declaration merging,
   bastante más complejo. Por eso `references` es una opción de `mongozod()`, como `indexes`. El
   nombre sigue al manual de MongoDB, que llama references a los `_id` guardados en otro documento.
   - **Destinos**: otro modelo, con un thunk como `() => BrandsModel`, para que se apliquen sus
     plugins. O una colección con su schema, para las que no tienen modelo, como `organizations`,
     que maneja Better Auth.
   - **`populate`**: usa la sintaxis de proyección de Mongo por referencia,
     `{ organization: { name: 1 } }`, o `true` para el documento entero. Ver
     [Referencias](./model.md#referencias).
   - **Para clientes**: `mz.populate` recibe la lista blanca como un schema recortado con `pick`,
     como hoy. Solo admite inclusión, y una referencia pedida sin campos recibe toda la lista
     blanca, nunca más.
   - **Tipos**: un `populate` escrito en el código da el tipo exacto. El que manda un cliente deja
     el campo como unión con el id, igual que hoy `WithPopulate`, pero calculada sola: desaparecen
     `WithPopulate` y los tipos `BrandRecord`.

## Qué reemplaza

- `parser.query` pasa a ser `mz.filter`.
- `parser.update` pasa a ser `mz.update`: el cliente manda `$unset` en vez de `null`.
- `removeDefaults`, `arrayable` y `existsable` desaparecen: se reemplazan por lo que se declara en
  cada constructor.
- El `sort` y la `projection` con `z.any()` de `paginationSchema` pasan a ser `mz.sort` y
  `mz.projection`, lo que cierra el hueco de wortise/adsgpt#231.
- La página con `skip` pasa a ser `mz.cursor`.
- `populateSchema` y `WithPopulate` pasan a ser `mz.populate` y los tipos calculados.
- `parser.search` no se reemplaza: cada proyecto convierte su `term` en filtro, por ejemplo con
  `$text`, que necesita un índice de texto.
