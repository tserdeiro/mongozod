import { baseOf, topOf } from './geometry'

export type Layer = 0 | 1 | 2

/** The three layers, from the top: the model, the schema and the official driver. */
export const LAYERS = ['mongozod', 'zod', 'mongodb']

/** How a field of the document reaches Zod: given by the caller, left out, or not fitting. */
export type Field = 'given' | 'default' | 'invalid'

interface Write {
  call: string
  parsed: string
  end: string
  /** The fields in the order of `postSchema`: `_id`, `title`, `status` and `tags`. */
  fields: Field[]
  /** The tag beside the card on MongoZod, on Zod and at the end. */
  labels: [string, string, string]
}

/** Two writes of the home page example, one that fits and one that does not. */
export const WRITES: [Write, Write] = [
  {
    call: "insertOne({ title: 'Hello, MongoDB' })",
    parsed: 'postSchema · _id, status and tags from defaults',
    end: 'posts · stored',
    fields: ['default', 'given', 'default', 'default'],
    labels: ['{ title }', '+ _id, status, tags', 'stored']
  },
  {
    call: "insertOne({ title: 'Draft', status: 'archived' })",
    parsed: 'ZodError · status: invalid_value',
    end: 'ZodError thrown · nothing written',
    fields: ['default', 'given', 'invalid', 'default'],
    labels: ['{ title, status }', 'ZodError', 'thrown']
  }
]

export interface Packet {
  z: number
  opacity: number
  state: 'plain' | 'parsed' | 'stored' | 'error'
  fields: Field[]
  /** How much of the defaults Zod has filled, from 0 to 1. */
  filled: number
  label: string
}

export interface Frame {
  /** The layer that is lit. */
  active: Layer
  /** The card: the document on its way, or `undefined` between writes. */
  packet?: Packet
  /** Whether Zod lights as an error. */
  error: boolean
  status: string
  /** The colour of the status line: red for a ZodError, green once stored. */
  tone: 'plain' | 'error' | 'stored'
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const span = (t: number, from: number, to: number) => ease((t - from) / (to - from))
const lerp = (a: number, b: number, share: number) => a + (b - a) * share

const VALID = 6.4
const INVALID = 5.4
export const LOOP = VALID + INVALID
const HIGH = 46
/** The card's thickness. */
export const CARD = 3

/** What the stack shows `t` seconds into its loop of the two writes. */
export function frameAt(time: number): Frame {
  const t = time % LOOP
  return t < VALID ? valid(t) : invalid(t - VALID)
}

/** The first 2.4 seconds of every write: it arrives on MongoZod and falls to Zod. */
function down(write: Write, t: number): Frame {
  const card: Omit<Packet, 'z' | 'opacity'> = {
    fields: write.fields,
    filled: 0,
    state: 'plain',
    label: write.labels[0]
  }
  if (t < 1.6)
    return {
      active: 0,
      packet: {
        ...card,
        z: lerp(topOf(0) + HIGH, topOf(0), span(t, 0, 0.6)),
        opacity: span(t, 0, 0.35)
      },
      error: false,
      status: write.call,
      tone: 'plain'
    }
  return {
    active: t < 2.2 ? 0 : 1,
    packet: { ...card, z: lerp(topOf(0), topOf(1), span(t, 1.6, 2.4)), opacity: 1 },
    error: false,
    status: write.call,
    tone: 'plain'
  }
}

function valid(t: number): Frame {
  const write = WRITES[0]
  if (t < 2.4) return down(write, t)
  const filled = span(t, 2.7, 3.3)
  const card: Omit<Packet, 'z' | 'label'> = {
    fields: write.fields,
    filled,
    opacity: 1,
    state: t < 2.7 ? 'plain' : 'parsed'
  }
  if (t < 3.8)
    return {
      active: 1,
      packet: { ...card, z: topOf(1), label: t < 2.7 ? write.labels[0] : write.labels[1] },
      error: false,
      status: write.parsed,
      tone: 'plain'
    }
  if (t < 4.6)
    return {
      active: t < 4.4 ? 1 : 2,
      packet: { ...card, z: lerp(topOf(1), topOf(2), span(t, 3.8, 4.6)), label: write.labels[1] },
      error: false,
      status: write.parsed,
      tone: 'plain'
    }
  const sink = span(t, 5.2, 5.9)
  return {
    active: 2,
    packet:
      sink < 1
        ? { ...card, state: 'stored', z: topOf(2) - CARD * sink, label: write.labels[2] }
        : undefined,
    error: false,
    status: write.end,
    tone: 'stored'
  }
}

function invalid(t: number): Frame {
  const write = WRITES[1]
  if (t < 2.4) return down(write, t)
  const card = { fields: write.fields, filled: 0 }
  if (t < 3.6)
    return {
      active: 1,
      packet: {
        ...card,
        z: topOf(1),
        opacity: 1,
        state: t < 2.7 ? 'plain' : 'error',
        label: t < 2.7 ? write.labels[0] : write.labels[1]
      },
      error: t >= 2.7,
      status: write.parsed,
      tone: 'error'
    }
  const rise = span(t, 3.6, 4.6)
  return {
    active: rise > 0.55 ? 0 : 1,
    packet: {
      ...card,
      z: lerp(topOf(1), baseOf(0) - CARD - 20, rise),
      opacity: 1 - span(t, 4.3, 4.9),
      state: 'error',
      label: write.labels[2]
    },
    error: rise < 0.55,
    status: write.end,
    tone: 'error'
  }
}
