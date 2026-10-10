# `history`

Guarda el documento antes y después, con el filtro y el update, dentro de una transacción, y
permite volver atrás un cambio.

- **Campos que exige**: ninguno.
- **Contexto**: lo necesita; su forma queda por diseñar.
- **Métodos**: `rollback`.

## Lo que ya se sabe

- **En la escritura**: registra cada escritura dentro de `withTransaction`, con un `middleware` que
  llama `next({ session })`. Es el segundo ejemplo de [`middleware`](./README.md#middleware), que
  compila en el prototipo.
- **Transacciones**: no hay helper propio. Usa `withSession` y `withTransaction` del driver, con
  `{ session }` en cada operación.
- **Orden**: conviene ponerlo al final de la lista de plugins, para que registre lo que llega al
  driver (ver [Reglas del contrato](./README.md#reglas-del-contrato)).
- **Borrados**: un borrado de [`softDelete`](./soft-delete.md) le llega como un update, y el
  historial registra quién hizo qué.
- **Sin `watch`**: un change stream avisa cuando el cambio ya quedó guardado, no dice quién lo hizo
  y en un update no trae el filtro ni los operadores. Por eso los hooks corren en la escritura.

Lo demás queda por diseñar.
