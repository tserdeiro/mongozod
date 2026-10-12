---
title: Dates and money
description: Store a date without a time as a string, store money as Decimal128, and compare decimals in filters.
---

A day, such as a birthday, and an amount of money are values where the type you pick decides
whether they stay exact. A day is a string with `z.iso.date()`, and an amount is a `Decimal128`
with `mz.decimal128()`:

```ts
import { Decimal128, ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z, ZodError } from 'zod'

const userSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  name: z.string(),
  birthday: z.iso.date(),
  balance: mz.decimal128()
})

const UsersModel = mongozod({ collection: 'users', db, schema: userSchema })

const { document: ana } = await UsersModel.insertOne({
  name: 'Ana',
  birthday: '1990-05-01',
  balance: '25.50'
})
// { _id: ObjectId('…'), name: 'Ana', birthday: '1990-05-01', balance: Decimal128('25.50') }
```

## A date without a time

`z.iso.date()` takes a string like `'1990-05-01'`, and rejects one that is not a day of the
calendar, like `'1990-02-30'`. Store it as that string, not as a `Date`:

- **It stays the same day.** A `Date` is an instant: one at midnight UTC is still the day before
  in the time zones behind UTC, when it's shown in local time. A string has no time zone to shift
  it.
- **It sorts and compares by date.** The year, the month and the day have a fixed width, so the
  order of the strings is the order of the days, in a `sort` and in a range:

```ts
const born1990s = await UsersModel.find(
  { birthday: { $gte: '1990-01-01', $lt: '2000-01-01' } },
  { sort: { birthday: 1 } }
)
```

Keep `Date`, or `mz.date()` for the inputs of an endpoint, for instants: when something happened,
such as `createdAt`.

## Money

`mz.decimal128()` stores a `Decimal128`, the BSON type for exact decimals. It takes a `Decimal128`,
its string, such as `'25.50'`, or a number, and always returns a `Decimal128`:

```ts
await UsersModel.updateOne({ _id: ana._id }, { $inc: { balance: '10.25' } })
// balance: Decimal128('35.75')

try {
  await UsersModel.updateOne({ _id: ana._id }, { $set: { balance: 0.1 + 0.2 } })
} catch (error) {
  if (error instanceof ZodError) console.error(z.prettifyError(error))
  // ✖ has more than 15 significant digits, which a number cannot keep: send it as a string
  //   → at $set.balance
}
```

A number passes only when it is the decimal it was written as, like `10.5`, so send amounts as
strings. [BSON types](../guides/bson-types.md#decimal128) lists what the field takes.

`$inc` and `$mul` add and multiply in the server, exactly. They parse their amount without the
checks of the field, so a balance with a `.refine()` that keeps it from being negative still takes
an `$inc` of `'-10'`. Put that condition in the filter instead, so the update doesn't match when
there isn't enough:

```ts
const price = Decimal128.fromString('9.99')

const { modifiedCount } = await UsersModel.updateOne(
  { _id: ana._id, balance: { $gte: price } },
  { $inc: { balance: '-9.99' } }
)
// modifiedCount: 0 when the balance is lower than 9.99
```

## Compare a decimal in a filter

A filter on a decimal field takes a `Decimal128`, not a `number`: a double isn't always the
decimal you wrote, and with `{ balance: { $gte: 9.99 } }` MongoDB leaves out a stored `9.99`.
Build the value with `Decimal128.fromString()`, as above:

```ts
const rich = await UsersModel.find({ balance: { $gte: Decimal128.fromString('1000') } })

// @ts-expect-error: a decimal field compares with a Decimal128, not a number
await UsersModel.find({ balance: { $gte: 1000 } })
```

A filter that comes from a client goes through `mz.filter`, which parses the string or the number
with the schema of the field:

```ts
const usersFilter = mz.filter(userSchema, { balance: ['$gte', '$lt'] })

const filter = usersFilter.parse({ balance: { $gte: '1000' } })
// { balance: { $gte: Decimal128('1000') } }

await UsersModel.find(filter)
```

## Send them as JSON

`JSON.stringify` turns a `Decimal128` into `{ "$numberDecimal": "35.75" }`, its Extended JSON, and
`mz.decimal128()` takes that form back, so an amount survives a round trip through JSON. A day
stays the same string. To send amounts as plain strings, encode the document with the schema:

```ts
const user = await UsersModel.findOne({ _id: ana._id })

if (user) {
  const body = z.encode(userSchema, user)
  // { _id: '6acd…', name: 'Ana', birthday: '1990-05-01', balance: '35.75' }
}
```

`z.encode` takes the whole document of the schema: a projected read or one with `populate` doesn't
fit it.

## Common mistakes

- **A birthday as a `Date` at midnight**: it shows the day before in time zones behind UTC. Store
  the day as a string with `z.iso.date()`.
- **Money as a `z.number()`**: a double can't hold every decimal exactly, and sums drift. Use
  `mz.decimal128()`.
- **Comparing a decimal with a number in a filter**: it doesn't compile, and MongoDB may leave out
  the stored value. Use `Decimal128.fromString()` or `mz.filter`.
- **Relying on a `.refine()` to keep a balance from going negative**: `$inc` doesn't run it. Put
  the condition in the filter of the update.
