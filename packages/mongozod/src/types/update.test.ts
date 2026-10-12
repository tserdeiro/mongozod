import type { ModelFilter } from './filter'
import type { PathSuggestions } from './path-suggestions'
import type { UpdateOptionsCheck, ModelUpdate } from './update'

import { expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'

const accountSchema = z.object({
  _id: z.string(),
  details: z.discriminatedUnion('plugin', [
    z.object({ loginCustomerId: z.string().optional(), plugin: z.literal('google-ads') }),
    z.object({ plugin: z.literal('wortise-ads') })
  ]),
  enabled: z.boolean().default(false)
})

const pluginSchema = z.object({
  _id: z.uuidv4(),
  connections: z
    .array(
      z.object({
        _id: z.string(),
        accounts: z.array(accountSchema).default([]),
        syncedAt: z
          .union([z.date(), z.iso.datetime().transform((value) => new Date(value))])
          .optional()
      })
    )
    .default([]),
  counters: z.record(z.string(), z.number().int()).optional(),
  createdAt: z.date(),
  history: z.array(z.object({ at: z.date(), label: z.string() })).default([]),
  nickname: z.string().optional(),
  organization: z.uuidv4(),
  pair: z.tuple([z.string(), z.number().int()]).optional(),
  publishedAt: z
    .union([z.date(), z.iso.datetime().transform((value) => new Date(value))])
    .optional(),
  scores: z.array(z.number()).default([]),
  title: z.string(),
  views: z.number().int().default(0)
})

type Plugin = typeof pluginSchema

/** Only checks what compiles, like the model's `updateOne` does. */
function update<
  const F extends ModelFilter<Plugin, F>,
  const U extends ModelUpdate<Plugin, U, F, O>,
  const O extends UpdateOptionsCheck<Plugin, U, O>
>(_filter: F, value: U, _options?: O) {
  return value
}

const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), shared: z.string(), url: z.url() }),
  z.object({ kind: z.literal('view'), seconds: z.number(), shared: z.string() })
])

function updateEvent<
  const F extends ModelFilter<typeof eventSchema, F>,
  const U extends ModelUpdate<typeof eventSchema, U, F, unknown>
>(_filter: F, value: U) {
  return value
}

const car = z.object({ kind: z.literal('car'), wheels: z.number().int() })
const vehicleSchema = z.discriminatedUnion('kind', [
  z.discriminatedUnion('fuel', [
    car.extend({ fuel: z.literal('electric'), kwh: z.number() }),
    car.extend({ fuel: z.literal('gas'), liters: z.number() })
  ]),
  z.object({ gears: z.number().int(), kind: z.literal('bike') })
])

function updateVehicle<
  const F extends ModelFilter<typeof vehicleSchema, F>,
  const U extends ModelUpdate<typeof vehicleSchema, U, F, unknown>
>(_filter: F, value: U) {
  return value
}

/** A partial update: an `undefined` value compiles, because it is dropped at runtime. */
function patchNickname(nickname?: string) {
  return update({}, { $set: { nickname } })
}

test('$set takes the input at each path, with positional operators and records', () => {
  update({}, { $set: { 'title': 'Ads', 'counters.clicks': 3 } })
  update({ 'connections._id': 'c' }, { $set: { 'connections.$.syncedAt': '2026-10-10T12:00:00Z' } })
  update({}, { $set: { 'connections.$[c]': { _id: 'c' } } }, { arrayFilters: [{ 'c._id': 'c' }] })
  update(
    {},
    { $set: { 'connections.$[].accounts.$[a].enabled': true } },
    { arrayFilters: [{ 'a._id': 'a' }] }
  )
  patchNickname()

  // @ts-expect-error a title is a string
  update({}, { $set: { title: 1 } })
  // @ts-expect-error "titel" is not a path of the document
  update({}, { $set: { titel: 'Ads' } })
  // @ts-expect-error an update does not go through an array without a positional operator
  update({}, { $set: { 'connections.syncedAt': new Date() } })
  // @ts-expect-error $[c] needs arrayFilters
  update({}, { $set: { 'connections.$[c].syncedAt': new Date() } })
  // @ts-expect-error the positional $ goes once in a path
  update({ 'connections._id': 'c' }, { $set: { 'connections.$.accounts.$.enabled': true } })
  update({ 'connections._id': 'c' }, { $set: { 'connections.$.accounts.$[].enabled': true } })
  update(
    {},
    // @ts-expect-error an identifier starts with a lowercase letter
    { $set: { 'connections.$[C].syncedAt': new Date() } },
    { arrayFilters: [{ 'C._id': 'c' }] }
  )
  update(
    {},
    { $set: { 'connections.$[c].syncedAt': new Date() } },
    // @ts-expect-error "x" is not an identifier of the update
    { arrayFilters: [{ 'x._id': 'c' }] }
  )
  expect(true).toBe(true)
})

const labelsSchema = z.object({
  labels: z.record(z.string(), z.string()),
  levels: z.record(z.enum(['high', 'low']), z.number()),
  limits: z.partialRecord(z.enum(['high', 'low']), z.number()),
  meta: z.object({ source: z.string() }).catchall(z.string())
})

function updateLabels<
  const F extends ModelFilter<typeof labelsSchema, F>,
  const U extends ModelUpdate<typeof labelsSchema, U, F, unknown>
>(_filter: F, value: U) {
  return value
}

const keySchema = z.object({
  _id: z.object({ day: z.string(), shop: z.string() }),
  n: z.number()
})

function updateKeys<
  const F extends ModelFilter<typeof keySchema, F>,
  const U extends ModelUpdate<typeof keySchema, U, F, O>,
  const O extends UpdateOptionsCheck<typeof keySchema, U, O>
>(_filter: F, value: U, _options?: O) {
  return value
}

test('the _id is written only with $setOnInsert: the server rejects a change of it', () => {
  update({}, { $setOnInsert: { _id: crypto.randomUUID() } }, { upsert: true })

  // @ts-expect-error the _id is immutable
  update({}, { $set: { _id: crypto.randomUUID() } })
  // @ts-expect-error the _id is immutable
  update({}, { $unset: { _id: '' } })
  // @ts-expect-error the _id is immutable
  update({}, { $rename: { nickname: '_id' } })

  updateKeys({}, { $setOnInsert: { _id: { day: 'mon', shop: 's1' } } })
  // @ts-expect-error an upsert sets the _id whole
  updateKeys({}, { $setOnInsert: { '_id.day': 'mon' } })

  // The upsert inserts the _id the filter gives, or the part of it, which $setOnInsert would change.
  const id = { day: 'mon', shop: 's1' }

  // @ts-expect-error the filter gives a part of the _id
  updateKeys({ '_id.shop': 's1' }, { $setOnInsert: { _id: id } }, { upsert: true })
  // @ts-expect-error the filter gives the _id
  updateKeys({ _id: { $in: [id] } }, { $setOnInsert: { _id: id } }, { upsert: true })
  updateKeys({ '_id.shop': { $in: ['s1', 's2'] } }, { $setOnInsert: { _id: id } }, { upsert: true })
  updateKeys({ '_id.shop': 's1' }, { $setOnInsert: { _id: id } })
  expect(true).toBe(true)
})

test('$unset and $rename take a key a record or a catchall may lack', () => {
  updateLabels({}, { $rename: { 'labels.old': 'labels.new' } })
  updateLabels({}, { $unset: { 'labels.home': '', 'limits.low': '', 'meta.extra': '' } })
  updateLabels({}, { $set: { 'labels.home': 'Home', 'levels.low': 1 } })

  // @ts-expect-error a record of a fixed set of keys has all of them
  updateLabels({}, { $unset: { 'levels.low': '' } })
  // @ts-expect-error source is a required field of meta
  updateLabels({}, { $unset: { 'meta.source': '' } })
  expect(true).toBe(true)
})

test('a key typed as a pattern under a record, and an index of a tuple', () => {
  const key: string = 'clicks'
  // An object literal widens a computed key to string (microsoft/TypeScript#13948): the pattern
  // only lasts in a value whose type declares it.
  const clicks: Record<`counters.${string}`, number> = { [`counters.${key}`]: 1 }
  const decimals: Record<`counters.${string}`, string> = { [`counters.${key}`]: '1' }

  update({}, { $inc: clicks, $set: { 'pair.0': 'a' } })
  update({}, { $inc: { 'pair.1': 1 } })

  // @ts-expect-error the counters are numbers
  update({}, { $set: decimals })
  // @ts-expect-error the key of an object literal widens to string, which could be any path
  update({}, { $set: { [`counters.${key}`]: 1 } })
  // @ts-expect-error the element 0 is a string
  update({}, { $inc: { 'pair.0': 1 } })
  // @ts-expect-error the tuple has two elements
  update({}, { $set: { 'pair.2': 1 } })
  expect(true).toBe(true)
})

const listSchema = z.object({
  items: z.array(z.object({ name: z.string().optional() })),
  name: z.string().optional(),
  nickname: z.string().optional(),
  notes: z.array(z.string().nullable()),
  pair: z.tuple([z.string(), z.number().optional()]).optional()
})

function updateList<
  const F extends ModelFilter<typeof listSchema, F>,
  const U extends ModelUpdate<typeof listSchema, U, F, unknown>
>(_filter: F, value: U) {
  return value
}

test('$unset sets an element to null, which it has to take, and $rename moves none', () => {
  updateList({}, { $unset: { 'notes.$': '', 'notes.0': '' } })

  // @ts-expect-error the element takes no null
  updateList({}, { $unset: { 'pair.1': '' } })
  // @ts-expect-error MongoDB cannot move an element of an array
  updateList({}, { $rename: { 'pair.1': 'pair' } })
  // @ts-expect-error nor a field inside one (code 2)
  updateList({}, { $rename: { 'items.0.name': 'name' } })
  // @ts-expect-error nor write one (code 2)
  updateList({}, { $rename: { name: 'items.0.name' } })
  updateList({}, { $rename: { name: 'nickname' } })
  expect(true).toBe(true)
})

test('each operator takes the fields it applies to', () => {
  update(
    {},
    { $inc: { 'views': 1, 'counters.clicks': 1 }, $mul: { views: 2 }, $bit: { views: { and: 1 } } }
  )
  update(
    {},
    { $min: { views: 0 }, $max: { createdAt: new Date() }, $currentDate: { createdAt: true } }
  )
  update({}, { $unset: { nickname: '' }, $rename: { nickname: 'title' } })
  update(
    {},
    {
      $push: { scores: { $each: [1, 2], $slice: -10 } },
      $addToSet: { history: { at: new Date(), label: 'x' } }
    }
  )
  update({}, { $pop: { scores: 1 }, $pullAll: { scores: [1] } })
  update({}, { $pull: { history: { label: 'x' }, scores: { $gt: 5 } } })

  // @ts-expect-error a title is not a number
  update({}, { $inc: { title: 1 } })
  // @ts-expect-error a title is required, so it cannot be unset
  update({}, { $unset: { title: '' } })
  // @ts-expect-error views has a default, so it cannot be unset
  update({}, { $unset: { views: 1 } })
  // @ts-expect-error a title is not a date
  update({}, { $currentDate: { title: true } })
  // @ts-expect-error a title is not an array
  update({}, { $push: { title: 'x' } })
  // @ts-expect-error an element of scores is a number
  update({}, { $addToSet: { scores: 'x' } })
  // @ts-expect-error an element of history has no "color"
  update({}, { $pull: { history: { color: 'red' } } })
  // @ts-expect-error a title is required, so it cannot be renamed
  update({}, { $rename: { title: 'nickname' } })
  // @ts-expect-error the server moves the string as it is, which publishedAt does not store
  update({}, { $rename: { nickname: 'publishedAt' } })
  expect(true).toBe(true)
})

test('an update is an object with operators', () => {
  // @ts-expect-error $foo is not an update operator
  update({}, { $foo: { title: 'x' } })
  // @ts-expect-error an update with a pipeline does not compile
  update({}, [{ $set: { title: 'x' } }])
  expect(true).toBe(true)
})

test('the filter fixes the type of document an update writes', () => {
  updateEvent({ kind: 'click' }, { $set: { url: 'https://a.b' } })
  updateEvent({ kind: { $in: ['view'] } }, { $inc: { seconds: 1 } })
  updateEvent(
    { $and: [{ shared: 's' }, { kind: { $eq: 'click' } }] },
    { $set: { url: 'https://a.b' } }
  )
  updateEvent({}, { $set: { shared: 'common to every type' } })
  updateEvent({}, { $setOnInsert: { kind: 'view' } })

  // @ts-expect-error without fixing "kind", a view could get a url
  updateEvent({}, { $set: { url: 'https://a.b' } })
  // @ts-expect-error $ne does not fix the type
  updateEvent({ kind: { $ne: 'view' } }, { $set: { url: 'https://a.b' } })
  // @ts-expect-error $or does not fix the type
  updateEvent({ $or: [{ kind: 'click' }] }, { $set: { url: 'https://a.b' } })
  // @ts-expect-error the discriminator changes only by replacing the document
  updateEvent({ kind: 'click' }, { $set: { kind: 'view' } })
  expect(true).toBe(true)
})

test('the filter fixes the discriminator of each nested union', () => {
  updateVehicle({ kind: 'car' }, { $set: { wheels: 3 } })
  updateVehicle({ fuel: 'electric', kind: 'car' }, { $set: { kwh: 70 } })
  updateVehicle({ $and: [{ kind: 'car' }, { fuel: { $in: ['gas'] } }] }, { $inc: { liters: 5 } })
  updateVehicle({}, { $setOnInsert: { fuel: 'gas', kind: 'car' } })

  // @ts-expect-error without fixing "kind", a bike could get wheels
  updateVehicle({}, { $set: { wheels: 3 } })
  // @ts-expect-error without fixing "fuel", a gas car could get kwh
  updateVehicle({ kind: 'car' }, { $set: { kwh: 70 } })
  // @ts-expect-error a bike has no fuel
  updateVehicle({ fuel: 'electric', kind: 'bike' }, { $set: { kwh: 70 } })
  // @ts-expect-error the inner discriminator changes only by replacing the document
  updateVehicle({ kind: 'car' }, { $set: { fuel: 'gas' } })
  expect(true).toBe(true)
})

test('an arrayFilters entry fixes the type of an element', () => {
  update(
    {},
    { $set: { 'connections.$[c].accounts.$[a].details.loginCustomerId': '123' } },
    { arrayFilters: [{ 'c._id': 'c' }, { 'a.details.plugin': 'google-ads' }] }
  )
  update(
    { 'connections._id': 'c' },
    { $set: { 'connections.$[].accounts.$[a].enabled': true } },
    { arrayFilters: [{ 'a._id': 'a' }] }
  )

  update(
    {},
    // @ts-expect-error without fixing the plugin, a Wortise Ads account could get a loginCustomerId
    { $set: { 'connections.$[c].accounts.$[a].details.loginCustomerId': '123' } },
    { arrayFilters: [{ 'c._id': 'c' }, { 'a._id': 'a' }] }
  )
  // @ts-expect-error an index fixes no type
  update({}, { $set: { 'connections.0.accounts.0.details.loginCustomerId': '123' } })
  update(
    {},
    // @ts-expect-error the plugin of the details changes only by replacing them
    { $set: { 'connections.$[c].accounts.$[a].details.plugin': 'wortise-ads' } },
    { arrayFilters: [{ 'c._id': 'c' }, { 'a._id': 'a' }] }
  )
  update(
    {},
    { $set: { 'connections.$[c].accounts.$[a].details': { plugin: 'wortise-ads' } } },
    { arrayFilters: [{ 'c._id': 'c' }, { 'a._id': 'a' }] }
  )
  expect(true).toBe(true)
})

test('suggests the positional $ once in a path, as MongoDB takes it', () => {
  const orderSchema = z.object({
    items: z.array(z.object({ qty: z.number(), tags: z.array(z.string()) }))
  })

  expectTypeOf<
    Extract<PathSuggestions<typeof orderSchema, 'update'>, `items.$${string}`>
  >().toEqualTypeOf<
    | 'items.$'
    | 'items.$.qty'
    | 'items.$.tags'
    | 'items.$.tags.$[]'
    | 'items.$[]'
    | 'items.$[].qty'
    | 'items.$[].tags'
    | 'items.$[].tags.$'
    | 'items.$[].tags.$[]'
  >()
})
