# `audit`

Completa `createdBy` y `updatedBy` desde el contexto.

- **Campos que exige**: `createdBy` y `updatedBy`.
- **Contexto**: `actor`, en las escrituras.
- **Métodos**: ninguno.

## Lo que ya se sabe

- **Tipo de los campos**: lo elige cada proyecto, como uuid u ObjectId, porque los declara el
  schema del modelo (ver [`fields`](./README.md#fields)).
- **Contexto**: lo declara solo para las escrituras, así que ahí es obligatorio y en las lecturas no
  existe. Es el ejemplo de [`context`](./README.md#context). Se verificó en los tipos con un
  prototipo, también en los métodos de los plugins.
- **Services**: el contexto viaja dentro de las `options` que el service le pasa al modelo, y lo
  arma el router, como hoy arma `scope.mutation`.
- **Borrados**: no hay `deletedBy`. Un borrado de [`softDelete`](./soft-delete.md) es un update, así
  que este plugin completa `updatedBy`.

Lo demás queda por diseñar.
