# Tipos

- **Escrituras**: `insertOne` recibe el `z.input` del schema, así que `insertOne({ organization })`
  sin `title` no compila. Los reemplazos reciben lo mismo (ver
  [Reemplazos](./operations.md#reemplazos)).
- **Lecturas**: devuelven el `z.output` del schema, ajustado por la proyección: con `{ title: 1 }`
  el resultado es `{ _id, title }`. Si la proyección llega en runtime, como la de un cliente, los
  campos que puede dejar afuera quedan opcionales.
- **Filtros, updates y proyecciones**: tienen tipos estrictos propios. Los del driver no alcanzan:
  tanto `Filter<Note>` como `StrictFilter<Note>`, que es experimental, aceptan
  `{ organization: ['a'] }` en un campo string. Los dos heredan de `Document` una firma de índice
  que acepta cualquier valor.
- **Paths con punto**: TypeScript no genera todos los paths posibles. Busca en el schema cada key
  que aparece en el código, igual que la validación en runtime. Vale para filtros, updates,
  `arrayFilters` y proyecciones. Así no hace falta un límite de niveles y se cubren los schemas
  recursivos. Generarlos todos, como hace el driver, no compila con `blueprints`. `arrayFilters` se
  tipa según los `$[id]` del update, y la proyección ajusta el tipo del resultado a lo que responde
  MongoDB. Las sugerencias del editor se calculan aparte desde el schema: hasta 6 niveles, con `$[]`
  en los arrays de los updates, y sin entrar en `z.custom`, records, `z.lazy` ni transforms. Una key
  de tipo `string` no compila: tiene que ser literal.

## Paths con punto

Los tipos siguen la regla de [Tipos](#tipos). Además:

- **Valores**: cada valor se valida con el schema de su path, con refinements, defaults y
  transforms: un ISO en `'connections.$[c].syncedAt'` llega como `Date`. Un objeto entero, como
  `'connections.$[c]'`, reemplaza el subdocumento completo, así que se valida como un insert. Las
  reglas por operador se aplican por path.
- **Hasta dónde llegan**: hasta donde acepta el schema, como Zod al validar. Además de los campos
  declarados, las keys de un record, las keys extra de un objeto con `.catchall()` o de un
  `looseObject`, tipadas con su catchall, y cualquier cosa debajo de `z.unknown()` o `z.any()`. Se
  frenan en los transforms y en `z.custom()`, que no tienen un schema para lo que hay adentro.
- **Por operación**: los filtros atraviesan arrays y aceptan índices. Los updates no los
  atraviesan, porque el servidor responde con el código 28, y usan un índice, `$`, `$[]` o
  `$[id]`. La proyección los atraviesa, pero no toma índices.
- **Proyección estricta**: no compila lo que MongoDB acepta pero responde distinto: un índice, un
  path que no existe, `$slice` o `$elemMatch` sobre algo que no es array, un string (MongoDB lo
  devuelve como valor literal) y un `$` que atraviesa dos arrays. Las expresiones de agregación se
  usan con `aggregate`, salvo `{ $meta: 'textScore' }`, para ordenar por relevancia.
- **Nombres de campo**: `mongozod()` lanza un `Error` si el schema tiene un campo con `.` o que
  empieza con `$`, porque ningún path llegaría a él. Las keys de los records se validan al escribir.
- **Inputs**: `mz` acepta paths con punto declarados uno por uno en la lista blanca. Los operadores
  posicionales y `arrayFilters` no se exponen a clientes en la v1: los arma el router.
- **Lo que no se puede validar en la app**: un `$set` con punto crea los padres que faltan, y un
  índice fuera del array lo rellena con `null`. Se documenta y lo cubre el `$jsonSchema`. Ninguno
  de los tres proyectos escribe con punto en un objeto opcional con otros campos obligatorios.
