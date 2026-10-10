# El modelo

```ts
import { mongozod } from 'mongozod'
import { softDelete } from 'mongozod/plugins/soft-delete'

export const NotesModel = mongozod({
  schema: noteSchema,
  collection: 'notes',
  db: () => client.db(),
  indexes: [{ key: { organization: 1, createdAt: -1 } }],
  plugins: [softDelete()]
})
```

- **`schema`**: un `z.object`, o una `z.discriminatedUnion` de objetos, de Zod o de Zod Mini, que
  describe el documento tal como se guarda. Con una unión, la colección guarda varios tipos de
  documento. El `_id` se genera con su `.default()`, como
  `z.uuidv4().default(() => crypto.randomUUID())`, que conviene definir una vez y reusar. Si el
  schema no lo declara, el driver genera un ObjectId.
- **`collection`**: el nombre de la colección.
- **`db`**: un `Db` del driver o una función que lo devuelve, que se resuelve en la primera
  operación. Así el modelo se puede definir al importar el módulo aunque la conexión dependa del
  entorno, como en los tests con `mongodb-memory-server`. Desde el `Db` se llega al cliente
  (`db.client`), que hace falta para sesiones y transacciones.
- **`indexes`**: los índices que crea `sync()`, con las claves tipadas contra el schema.
- **`plugins`**: los plugins del modelo, en el orden en que se aplican.
- **`references`**: los campos que guardan el `_id` de otra colección, lo que `populate` puede
  expandir. Se describen en [Inputs de los endpoints](./inputs.md#decisiones-de-los-inputs).
- **`virtuals`**: campos calculados a partir de otros, que no se guardan. Ver [Virtuals](#virtuals).

El modelo expone `.schema`, `.collection` (el `Collection` tipado del driver), `.db` y `.name`.
Además tiene las operaciones, `sync()` y los métodos de sus plugins.

## Virtuals

El único virtual de los tres proyectos es `fullName`, en las cuentas de wortise-dashboard-monorepo:

```ts
export const AccountsModel = mongozod({
  schema: accountSchema,
  collection: 'accounts',
  db,
  virtuals: {
    fullName: accountSchema
      .pick({ firstName: true, lastName: true })
      .transform((account) => `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim())
  }
})
```

- **Un schema de Zod**: el `pick` declara qué campos necesita el virtual y el `transform` lo
  calcula, así que el `transform` recibe solo esos campos, tipados. Es un objeto literal sin helper,
  porque cada virtual ya trae sus tipos, y se puede definir junto al schema y usar también en el
  cliente. better-auth no tiene un equivalente: ni `additionalFields` ni `customSession` declaran de
  qué campos depende un valor.
- **Chequeos**: no compila un virtual que lee un campo que el documento no tiene, ni uno que lo lee
  con otro tipo. mongozod vuelve a validar los campos del `pick` en cada lectura, así que un campo
  cuyo transform cambia el tipo no se puede tomar: tampoco compila.
- **Proyección**: si pide un virtual, mongozod le pide al servidor los campos del `pick`, lo calcula
  y devuelve solo lo pedido: `{ fullName: 1 }` da `{ _id, fullName }`. Una exclusión lo mantiene,
  salvo que excluya uno de esos campos. Hoy la tabla de billings de wortise-dashboard-monorepo tiene
  que pedir `firstName` y `lastName` para recibir `fullName`.
- **`populate`**: pasa por el modelo referenciado, así que aplica sus virtuals:
  `{ createdBy: { fullName: 1 } }` da `createdBy: { _id, fullName }`.
- **Listas blancas**: los schemas de validación no importan modelos, así que una lista blanca de
  `mz.populate` o `mz.projection` suma el virtual como un campo más, como
  `accountSchema.pick({ _id: true }).extend({ fullName: z.string() })`. Cuando el router le pasa el
  input al modelo, los tipos comprueban que cada key sea un campo o un virtual del modelo
  referenciado.
- **Lo que no hace**: como en Mongoose, un virtual no se guarda en la base, no se puede filtrar ni
  ordenar por él (no compila) y escribirlo tampoco compila. `aggregate` no los aplica: se calculan
  con `$addFields`. No hay setters en la v1, porque ningún proyecto los usa.

## Varios tipos de documento

Una colección puede guardar varios tipos de documento, lo que Mongoose resuelve con sus
discriminators. El schema es una `z.discriminatedUnion` de objetos:

```ts
const eventSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('click'), url: z.url() }),
  base.extend({ kind: z.literal('view'), seconds: z.number().int() })
])

await EventsModel.updateOne({ kind: 'click' }, { $set: { url } })

// error: "url" is not in every type the filter allows: fix "kind" in the filter
await EventsModel.updateOne({}, { $set: { url } })
```

- **Key**: es la que se le pasa a `z.discriminatedUnion`, como el `discriminatorKey` de Mongoose;
  `kind` es solo el ejemplo. A diferencia de Mongoose, que agrega su propio campo `__t`, es un campo
  más del schema.
- **Paths**: cada key se busca en todos los tipos, y la proyección se tipa tipo por tipo.
- **Updates**: cada campo que escribe un update tiene que estar en todos los tipos que permite el
  filtro. El filtro fija el tipo con una igualdad, `$eq` o `$in` sobre el discriminador, en su
  primer nivel o dentro de `$and`, que es como los routers de adsgpt componen los filtros. Los
  campos que tienen todos los tipos no necesitan filtro, y un valor tiene que servir para todos los
  tipos permitidos.
- **Discriminador**: no se cambia con un update, porque el documento quedaría sin los campos de su
  nuevo tipo; se reemplaza con `replaceOne`. Mongoose tampoco deja actualizarlo, salvo con
  `overwriteDiscriminatorKey`. En un upsert, `$setOnInsert` sí puede fijarlo.
- **Plugins**: los campos que exige un plugin, como `deletedAt`, tienen que estar en todos los
  tipos.
- **Intersecciones**: no se aceptan. La documentación de Zod recomienda `A.extend(B)` para combinar
  objetos, porque una intersección no tiene `pick` ni `omit`, y `.extend()` da un `z.object`.
- **Uniones dentro de un campo**: la misma regla. El discriminador de cada unión del path lo fija
  la condición que elige su documento o su elemento: el filtro o, si el path pasa por un `$[id]`,
  su entrada de `arrayFilters`, como `{ 'a.details.plugin': PluginId.GoogleAds }`. Con `$`, `$[]`
  o un índice no se puede fijar, así que solo se escriben los campos de todos los tipos. El
  discriminador de una unión anidada cambia reemplazando el objeto entero.
