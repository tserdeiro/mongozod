---
'mongozod': patch
---

`mz.update` takes `$unset` of a key a record or a catchall may lack, as the updates of the model
do: it threw that the key was required. Its types still take only the paths the editor suggests.
