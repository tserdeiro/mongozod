# `logger`

Registra cada operación, su colección y su duración con el logger del proyecto.

- **Campos que exige**: ninguno.
- **Opciones o contexto**: ninguno.
- **Métodos**: ninguno.

## Lo que ya se sabe

- **`middleware`**: recibe el logger del proyecto y envuelve cada operación para medirla. Es el
  ejemplo de [`middleware`](./README.md#middleware), que compila en el prototipo.
- **Orden**: conviene ponerlo primero en la lista de plugins, para que mida todo (ver
  [Reglas del contrato](./README.md#reglas-del-contrato)).

Lo demás queda por diseñar.
