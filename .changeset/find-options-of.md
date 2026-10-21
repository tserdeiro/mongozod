---
'mongozod': minor
---

`FindOptionsOf<M>` types the options of a `find` or a `findOne` that a service takes from a router: the driver's, a `sort` of the paths of the document and, on a model with references, a `populate` as `mz.populate` outputs it, plus the options and the context its plugins ask for. The router passes the output of its inputs as it is, and the server its own sort or limit.
