# `timestamps`

Completa `createdAt` al insertar (en un upsert, con `$setOnInsert`) y `updatedAt` en cada
escritura.

- **Campos que exige**: `createdAt` y `updatedAt`, con otro nombre si se configura.
- **Opciones**: los nombres de los campos, y `timestamps: false` por operación.
- **Métodos**: ninguno.

## Alcance

- **Solo `createdAt` y `updatedAt`**, como en Mongoose: son las únicas fechas que tiene cualquier
  documento. Las demás son eventos del dominio, como `approvedAt` o `syncedAt`, y `deletedAt` es de
  [`softDelete`](./soft-delete.md).
- **Configurables**: cada una se puede renombrar o apagar, como `timestamps({ updatedAt: false })`
  en una colección cuyos documentos no cambian. Los campos que exige el plugin siguen a esas
  opciones.
- **Por operación**: una operación puede saltearlos con la opción `timestamps: false`, como en
  Mongoose.
- **`createdAt`**: no se cambia con un update.

## Lo que ya se sabe

- **Borrados**: un borrado de `softDelete` le llega como un update.
- **Campos**: siguen a las opciones, renombrados o apagados, en los tipos y en runtime. Se verificó
  con un prototipo (ver [Qué se verificó](../verified.md)).

Lo demás queda por diseñar.
