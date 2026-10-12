import { describe, expect, test } from 'vitest'
import { z } from 'zod'

import { set } from '../mzod/fields/set'

import { parseUpdate } from './parse-update'

const accountSchema = z.object({
  _id: z.string(),
  details: z.discriminatedUnion('plugin', [
    z.object({ loginCustomerId: z.string().optional(), plugin: z.literal('google-ads') }),
    z.object({ plugin: z.literal('wortise-ads') })
  ]),
  enabled: z.boolean().default(false)
})

const pluginSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
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
  data: z.unknown().optional(),
  history: z.array(z.object({ at: z.date(), label: z.string() })).default([]),
  nickname: z.string().optional(),
  pair: z.tuple([z.string(), z.number().int()]).optional(),
  scores: z.array(z.number()).default([]),
  settings: z.object({ layout: z.string().default('grid'), theme: z.string() }).optional(),
  title: z.string().min(1),
  views: z.number().int().default(0)
})

const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), shared: z.string(), url: z.url() }),
  z.object({ kind: z.literal('view'), seconds: z.number(), shared: z.string() })
])

/** The messages of the issues an update throws, by path. */
async function issuesOf(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof z.ZodError) {
      return error.issues.map((issue) => [issue.path.join(' '), issue.message])
    }
  }

  return []
}

describe('values', () => {
  test('are parsed with the schema at their path, transforms and defaults included', async () => {
    const update = await parseUpdate(
      pluginSchema,
      {},
      {
        $set: {
          'connections.$[c]': { _id: 'c' },
          'connections.$[c].syncedAt': '2026-10-10T12:00:00Z',
          'counters.clicks': 3
        }
      },
      { arrayFilters: [{ 'c._id': 'c' }] }
    )

    expect(update).toEqual({
      $set: {
        'connections.$[c]': { _id: 'c', accounts: [] },
        'connections.$[c].syncedAt': new Date('2026-10-10T12:00:00Z'),
        'counters.clicks': 3
      }
    })
  })

  test('drop the keys left undefined, at any level', async () => {
    expect(
      await parseUpdate(
        pluginSchema,
        {},
        { $set: { nickname: undefined, settings: { theme: 'dark', layout: undefined } } }
      )
    ).toEqual({ $set: { settings: { layout: 'grid', theme: 'dark' } } })
  })

  test('reject what the field does not take, with every problem at once', async () => {
    expect(
      await issuesOf(() =>
        parseUpdate(
          pluginSchema,
          {},
          { $set: { 'counters.clicks': 1.5, 'title': '', 'titel': 'x' } }
        )
      )
    ).toEqual([
      ['$set counters.clicks', 'Invalid input: expected int, received number'],
      ['$set title', 'Too small: expected string to have >=1 characters'],
      ['$set titel', '"titel" is not a path of the document']
    ])
  })

  test('reject keys no path can reach, inside records and unknown values', async () => {
    expect(
      await issuesOf(() =>
        parseUpdate(pluginSchema, {}, { $set: { counters: { 'a.b': 1 }, data: { $x: 1 } } })
      )
    ).toEqual([
      [
        '$set counters a.b',
        '"a.b" cannot be a key: no path reaches a key with a "." or starting with "$"'
      ],
      [
        '$set data $x',
        '"$x" cannot be a key: no path reaches a key with a "." or starting with "$"'
      ]
    ])
  })
})

describe('operators', () => {
  test('take the fields they apply to', async () => {
    const update = {
      $addToSet: { history: { $each: [{ at: new Date(0), label: 'x' }] } },
      $bit: { views: { and: 1 } },
      $currentDate: { createdAt: true },
      $inc: { 'counters.clicks': 1, 'views': 1 },
      $max: { createdAt: new Date(0) },
      $mul: { views: 2 },
      $pop: { scores: 1 },
      $pull: { history: { label: 'x' } },
      $pullAll: { scores: [1] },
      $push: { scores: { $each: [1, 2], $slice: -10 } },
      $rename: { nickname: 'title' },
      $unset: { settings: '' }
    }

    expect(await parseUpdate(pluginSchema, {}, update)).toEqual(update)
  })

  test('reject the fields they do not apply to', async () => {
    expect(
      await issuesOf(() =>
        parseUpdate(
          pluginSchema,
          {},
          {
            $currentDate: { createdAt: { $type: 'timestamp' }, title: true },
            $foo: { title: 1 },
            $inc: { title: 1, views: 0.5 },
            $push: { scores: 'x', title: 'x' },
            $rename: { title: 'nickname' },
            $unset: { title: '', views: '' }
          }
        )
      )
    ).toEqual([
      ['$currentDate createdAt', "$currentDate takes true or { $type: 'date' }"],
      ['$currentDate title', '"title" is not a date'],
      ['$foo', '"$foo" is not an update operator'],
      ['$inc title', '"title" is not a number'],
      ['$inc views', '"views" is an integer'],
      ['$push scores', 'Invalid input: expected number, received string'],
      ['$push title', '"title" is not an array'],
      ['$rename title', '"title" is required, so it cannot be renamed'],
      ['$unset title', '"title" is required, so it cannot be unset'],
      ['$unset views', '"views" is required, so it cannot be unset']
    ])
  })

  test('write the _id only with $setOnInsert: the server rejects a change of it', async () => {
    const message = 'the _id is immutable: an upsert sets it whole with $setOnInsert'
    const id = crypto.randomUUID()

    expect(
      await issuesOf(() =>
        parseUpdate(
          pluginSchema,
          {},
          { $rename: { nickname: '_id' }, $set: { _id: id }, $unset: { _id: '' } }
        )
      )
    ).toEqual([
      ['$rename nickname', message],
      ['$set _id', message],
      ['$unset _id', message]
    ])
    expect(
      await parseUpdate(
        pluginSchema,
        { title: 'x' },
        { $setOnInsert: { _id: id, createdAt: new Date(0) } },
        { upsert: true }
      )
    ).toMatchObject({ $setOnInsert: { _id: id } })

    // A path inside it fails as soon as the filter or another path gives a part of the _id.
    const keySchema = z.object({
      _id: z.object({ day: z.string(), shop: z.string() }),
      n: z.number()
    })

    expect(
      await issuesOf(() =>
        parseUpdate(
          keySchema,
          { '_id.shop': 's1' },
          { $setOnInsert: { '_id.day': 'mon', 'n': 1 } },
          { upsert: true }
        )
      )
    ).toEqual([['$setOnInsert _id.day', message]])

    // The upsert inserts the _id the filter gives, or the part of it, which $setOnInsert would
    // change (66); with the same value, it repeats it.
    const given = 'the filter gives the _id, which the upsert inserts: leave it out of $setOnInsert'
    const key = { day: 'mon', shop: 's1' }

    const filters = [{ '_id.shop': 's1' }, { _id: key }, { $and: [{ _id: { $in: [key] } }] }]

    expect(
      await Promise.all(
        filters.map((filter) =>
          issuesOf(() =>
            parseUpdate(
              keySchema,
              filter,
              { $set: { n: 1 }, $setOnInsert: { _id: key } },
              { upsert: true }
            )
          )
        )
      )
    ).toEqual(filters.map(() => [['$setOnInsert _id', given]]))

    expect(
      await parseUpdate(
        keySchema,
        { '_id.shop': { $in: ['s1', 's2'] } },
        { $set: { n: 1 }, $setOnInsert: { _id: key } },
        { upsert: true }
      )
    ).toEqual({ $set: { n: 1 }, $setOnInsert: { _id: key } })
  })

  test('$unset and $rename take a key a record or a catchall may lack', async () => {
    const schema = z.object({
      labels: z.record(z.string(), z.string()),
      levels: z.record(z.enum(['high', 'low']), z.number()),
      limits: z.partialRecord(z.enum(['high', 'low']), z.number()),
      meta: z.object({ source: z.string() }).catchall(z.string())
    })
    const update = {
      $rename: { 'labels.old': 'labels.new' },
      $unset: { 'labels.home': '', 'limits.low': '', 'meta.extra': '' }
    }

    expect(await parseUpdate(schema, {}, update)).toEqual(update)
    expect(
      await issuesOf(() =>
        parseUpdate(schema, {}, { $unset: { 'levels.low': '', 'meta.source': '' } })
      )
    ).toEqual([
      ['$unset levels.low', '"levels.low" is required, so it cannot be unset'],
      ['$unset meta.source', '"meta.source" is required, so it cannot be unset']
    ])
  })

  test('take an index of a tuple, with the schema of its position', async () => {
    const update = { $inc: { 'pair.1': 1 }, $set: { 'pair.0': 'a' } }

    expect(await parseUpdate(pluginSchema, {}, update)).toEqual(update)
    expect(
      await issuesOf(() =>
        parseUpdate(pluginSchema, {}, { $inc: { 'pair.0': 1 }, $set: { 'pair.2': 'a' } })
      )
    ).toEqual([
      ['$inc pair.0', '"pair.0" is not a number'],
      ['$set pair.2', '"pair.2" is not a path of the document']
    ])
  })

  test('$unset an element to null, which it has to take, and $rename none', async () => {
    const listSchema = z.object({
      notes: z.array(z.string().nullable()),
      pair: z.tuple([z.string(), z.number().optional()]),
      tags: z.array(z.string())
    })
    const update = { $unset: { 'notes.$': '', 'notes.0': '' } }

    expect(await parseUpdate(listSchema, {}, update)).toEqual(update)
    expect(
      await issuesOf(() =>
        parseUpdate(
          listSchema,
          {},
          { $rename: { 'pair.1': 'other' }, $unset: { 'pair.1': '', 'tags.$[]': '' } }
        )
      )
    ).toEqual([
      ['$rename pair.1', '"pair.1" is an element of an array, which $rename cannot move'],
      [
        '$unset pair.1',
        '$unset sets "pair.1", an element of an array, to null, which it does not take'
      ],
      [
        '$unset tags.$[]',
        '$unset sets "tags.$[]", an element of an array, to null, which it does not take'
      ]
    ])
  })

  test('keep a set: no $push, and no write to one of its elements', async () => {
    const postSchema = z.object({
      sections: z.array(z.object({ _id: z.string(), labels: set(z.string()) })),
      tags: set(z.string())
    })
    const filter = { 'sections._id': 's1' }
    const whole = 'write it whole, or use $addToSet, $pull, $pullAll or $pop'

    expect(
      await parseUpdate(postSchema, filter, { $addToSet: { 'sections.$.labels': 'x' } })
    ).toEqual({
      $addToSet: { 'sections.$.labels': 'x' }
    })
    expect(
      await issuesOf(() =>
        parseUpdate(postSchema, filter, {
          $inc: { 'tags.$': 1 },
          $push: { tags: 'a' },
          $set: { 'sections.$.labels.$[]': 'b', 'tags.0': 'b' }
        })
      )
    ).toEqual([
      ['$inc tags.$', `"tags" is a set: ${whole}`],
      ['$push tags', '"tags" is a set: use $addToSet'],
      ['$set sections.$.labels.$[]', `"sections.$.labels" is a set: ${whole}`],
      ['$set tags.0', `"tags" is a set: ${whole}`]
    ])
  })

  test('take the positional $ once in a path, as MongoDB does', async () => {
    const orderSchema = z.object({
      items: z.array(z.object({ tags: z.array(z.string()) }))
    })
    const filter = { 'items.tags': 'a' }

    expect(await parseUpdate(orderSchema, filter, { $set: { 'items.$.tags.$[]': 'z' } })).toEqual({
      $set: { 'items.$.tags.$[]': 'z' }
    })
    expect(
      await issuesOf(() => parseUpdate(orderSchema, filter, { $set: { 'items.$.tags.$': 'z' } }))
    ).toEqual([['$set items.$.tags.$', '"items.$.tags.$": the positional $ goes once in a path']])
  })

  test('reject a pipeline, which the model takes before with updatePipeline: true', async () => {
    expect(await issuesOf(() => parseUpdate(pluginSchema, {}, [{ $set: { title: 'x' } }]))).toEqual(
      [['', 'an update is an object of operators, or a pipeline with updatePipeline: true']]
    )
  })
})

describe('discriminated unions', () => {
  test('the filter fixes the type of document an update writes', async () => {
    expect(
      await parseUpdate(eventSchema, { kind: 'click' }, { $set: { url: 'https://a.b' } })
    ).toBeDefined()
    expect(
      await parseUpdate(eventSchema, { kind: { $in: ['view'] } }, { $inc: { seconds: 1 } })
    ).toBeDefined()
    expect(
      await parseUpdate(
        eventSchema,
        { $and: [{ kind: { $eq: 'click' } }] },
        { $set: { url: 'https://a.b' } }
      )
    ).toBeDefined()
    expect(
      await parseUpdate(eventSchema, {}, { $set: { shared: 'x' }, $setOnInsert: { kind: 'view' } })
    ).toBeDefined()

    expect(
      await issuesOf(() => parseUpdate(eventSchema, {}, { $set: { url: 'https://a.b' } }))
    ).toEqual([['$set url', '"url" is not in every type allowed: fix "kind" in the filter']])
    expect(
      await issuesOf(() =>
        parseUpdate(eventSchema, { kind: { $ne: 'view' } }, { $set: { url: 'https://a.b' } })
      )
    ).toEqual([['$set url', '"url" is not in every type allowed: fix "kind" in the filter']])
    expect(
      await issuesOf(() => parseUpdate(eventSchema, { kind: 'click' }, { $set: { kind: 'view' } }))
    ).toEqual([['$set kind', '"kind" changes the type of its object: replace the object']])
  })

  test('the filter fixes the discriminator of each nested union', async () => {
    const car = z.object({ kind: z.literal('car'), wheels: z.number().int() })
    const vehicleSchema = z.discriminatedUnion('kind', [
      z.discriminatedUnion('fuel', [
        car.extend({ fuel: z.literal('electric'), kwh: z.number() }),
        car.extend({ fuel: z.literal('gas'), liters: z.number() })
      ]),
      z.object({ gears: z.number().int(), kind: z.literal('bike') })
    ])

    expect(await parseUpdate(vehicleSchema, { kind: 'car' }, { $set: { wheels: 3 } })).toBeDefined()
    expect(
      await parseUpdate(vehicleSchema, { fuel: 'electric', kind: 'car' }, { $set: { kwh: 70 } })
    ).toBeDefined()
    expect(
      await parseUpdate(vehicleSchema, {}, { $setOnInsert: { fuel: 'gas', kind: 'car' } })
    ).toBeDefined()

    expect(await issuesOf(() => parseUpdate(vehicleSchema, {}, { $set: { wheels: 3 } }))).toEqual([
      ['$set wheels', '"wheels" is not in every type allowed: fix "kind" in the filter']
    ])
    expect(
      await issuesOf(() => parseUpdate(vehicleSchema, { kind: 'car' }, { $set: { kwh: 70 } }))
    ).toEqual([['$set kwh', '"kwh" is not in every type allowed: fix "fuel" in the filter']])
    expect(
      await issuesOf(() => parseUpdate(vehicleSchema, { kind: 'car' }, { $set: { fuel: 'gas' } }))
    ).toEqual([['$set fuel', '"fuel" changes the type of its object: replace the object']])
  })

  test('an arrayFilters entry fixes the type of an element', async () => {
    const path = 'connections.$[c].accounts.$[a].details.loginCustomerId'

    expect(
      await parseUpdate(
        pluginSchema,
        {},
        { $set: { [path]: '123' } },
        { arrayFilters: [{ 'c._id': 'c' }, { 'a.details.plugin': 'google-ads' }] }
      )
    ).toEqual({ $set: { [path]: '123' } })
    expect(
      await issuesOf(() =>
        parseUpdate(
          pluginSchema,
          {},
          { $set: { [path]: '123' } },
          { arrayFilters: [{ 'c._id': 'c' }, { 'a._id': 'a' }] }
        )
      )
    ).toEqual([
      [
        `$set ${path}`,
        `"${path}" is not in every type allowed: fix "a.details.plugin" in arrayFilters`
      ]
    ])
    expect(
      await issuesOf(() =>
        parseUpdate(
          pluginSchema,
          {},
          { $set: { 'connections.0.accounts.0.details.loginCustomerId': '1' } }
        )
      )
    ).toEqual([
      [
        '$set connections.0.accounts.0.details.loginCustomerId',
        '"connections.0.accounts.0.details.loginCustomerId" is not in every type allowed: reach "connections.0.accounts" with $[id] and fix "id.details.plugin" in arrayFilters'
      ]
    ])
  })
})

/** The issues of an upsert of the plugins with a filter, which stamps the required createdAt. */
function upsertIssues(filter: Record<string, unknown>) {
  return issuesOf(() =>
    parseUpdate(pluginSchema, filter, { $currentDate: { createdAt: true } }, { upsert: true })
  )
}

describe('upserts', () => {
  const missing = ': an upsert inserts it, so give it in the filter or with $setOnInsert'
  test('validate the document the server would insert', async () => {
    expect(
      await issuesOf(() =>
        parseUpdate(
          pluginSchema,
          { _id: crypto.randomUUID() },
          { $inc: { views: 1 } },
          { upsert: true }
        )
      )
    ).toEqual([
      ['createdAt', `Invalid input: expected date, received undefined${missing}`],
      ['title', `Invalid input: expected string, received undefined${missing}`]
    ])
  })

  test('add the defaults it lacks, without touching what the filter or the update decide', async () => {
    const update = await parseUpdate(
      pluginSchema,
      { title: 'Ads' },
      { $currentDate: { createdAt: true }, $set: { 'settings.theme': 'dark' } },
      { upsert: true }
    )

    expect(update).toEqual({
      $currentDate: { createdAt: true },
      $set: { 'settings.theme': 'dark' },
      $setOnInsert: {
        '_id': expect.any(String),
        'connections': [],
        'history': [],
        'scores': [],
        'settings.layout': 'grid',
        'views': 0
      }
    })
  })

  test('copy the filter as the server does: a regex matches, and undefined is null', async () => {
    // The regex is not copied, so only the missing title fails.
    expect(await upsertIssues({ title: /^Ads/ })).toEqual([
      ['title', `Invalid input: expected string, received undefined${missing}`]
    ])
    expect(await upsertIssues({ title: 'Ads', nickname: undefined })).toEqual([
      ['nickname', 'Invalid input: expected string, received null']
    ])
    expect(
      await Promise.all([null, undefined].map((_id) => upsertIssues({ _id, title: 'Ads' })))
    ).toEqual(
      [null, undefined].map(() => [
        ['_id', 'an upsert whose filter has a null _id would insert a document with a null _id']
      ])
    )
  })

  test("reject a filter's value that the schema stores differently, unless the update writes it", async () => {
    const schema = z.object({
      email: z.string().toLowerCase(),
      settings: z.object({ layout: z.string().default('grid'), theme: z.string() }).optional()
    })
    const message =
      'as it is, which the schema stores differently: filter by the value the schema stores'

    expect(
      await issuesOf(() =>
        parseUpdate(
          schema,
          { email: 'Ana@Example.com', settings: { theme: 'dark' } },
          { $setOnInsert: {} },
          { upsert: true }
        )
      )
    ).toEqual([
      ['email', `the upsert would insert the filter's "email" ${message}`],
      ['settings', `the upsert would insert the filter's "settings" ${message}`]
    ])
    expect(
      await parseUpdate(
        schema,
        { email: 'ana@example.com', settings: { theme: 'dark' } },
        { $set: { 'settings.layout': 'list' } },
        { upsert: true }
      )
    ).toEqual({ $set: { 'settings.layout': 'list' } })
  })
})
