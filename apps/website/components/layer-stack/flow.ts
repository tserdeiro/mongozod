import { baseOf, topOf } from './geometry'

export type Layer = 0 | 1 | 2

/** The three layers, from the top. */
export const LAYERS: { level: Layer; key: string; name: string; role: string; body: string }[] = [
  {
    level: 0,
    key: 'mongozod',
    name: 'MongoZod',
    role: 'The model',
    body: 'insertOne, find, updateOne and the rest, with the types of your schema.'
  },
  {
    level: 1,
    key: 'zod',
    name: 'Zod',
    role: 'The schema',
    body: 'Validates every write, fills its defaults and throws a ZodError when it does not fit.'
  },
  {
    level: 2,
    key: 'mongodb',
    name: 'MongoDB',
    role: 'The official driver',
    body: 'Stores what Zod returns. A write that does not fit never reaches it.'
  }
]

/** Two writes of the home page example, one that fits and one that does not. */
export const WRITES = [
  {
    call: "insertOne({ title: 'Hello, MongoDB' })",
    parsed: 'postSchema · _id, status and tags from defaults',
    end: 'posts · stored'
  },
  {
    call: "insertOne({ title: 'Draft', status: 'archived' })",
    parsed: 'ZodError · status: invalid_value',
    end: 'ZodError thrown · nothing written'
  }
]

export interface Frame {
  /** The layer that is lit. */
  active: Layer
  /** The packet: the document on its way, or `undefined` between writes. */
  packet?: { z: number; height: number; opacity: number; state: 'plain' | 'parsed' | 'error' }
  /** Whether Zod lights as an error. */
  error: boolean
  status: string
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const span = (t: number, from: number, to: number) => ease((t - from) / (to - from))
const lerp = (a: number, b: number, share: number) => a + (b - a) * share

const VALID = 6.4
const INVALID = 5.4
export const LOOP = VALID + INVALID
const HIGH = 46
const PLAIN = 7
const FULL = 11

/** What the stack shows `t` seconds into its loop of the two writes. */
export function frameAt(time: number): Frame {
  const t = time % LOOP
  if (t < VALID) return valid(t)
  return invalid(t - VALID)
}

function arrive(t: number) {
  return { z: lerp(topOf(0) + HIGH, topOf(0), span(t, 0, 0.6)), opacity: span(t, 0, 0.35) }
}

function valid(t: number): Frame {
  const write = WRITES[0]
  const { z, opacity } = arrive(t)
  if (t < 1.6)
    return {
      active: 0,
      packet: { z, height: PLAIN, opacity, state: 'plain' },
      error: false,
      status: write.call
    }
  if (t < 2.4) {
    const fall = lerp(topOf(0), topOf(1), span(t, 1.6, 2.4))
    return {
      active: t < 2.2 ? 0 : 1,
      packet: { z: fall, height: PLAIN, opacity: 1, state: 'plain' },
      error: false,
      status: write.call
    }
  }
  if (t < 3.8) {
    const height = lerp(PLAIN, FULL, span(t, 2.7, 3.1))
    const state = t < 2.7 ? 'plain' : 'parsed'
    return {
      active: 1,
      packet: { z: topOf(1), height, opacity: 1, state },
      error: false,
      status: write.parsed
    }
  }
  if (t < 4.6) {
    const fall = lerp(topOf(1), topOf(2), span(t, 3.8, 4.6))
    return {
      active: t < 4.4 ? 1 : 2,
      packet: { z: fall, height: FULL, opacity: 1, state: 'parsed' },
      error: false,
      status: write.parsed
    }
  }
  const sink = span(t, 5.2, 5.9)
  return {
    active: 2,
    packet:
      sink < 1
        ? { z: topOf(2) - FULL * sink, height: FULL, opacity: 1, state: 'parsed' }
        : undefined,
    error: false,
    status: write.end
  }
}

function invalid(t: number): Frame {
  const write = WRITES[1]
  const { z, opacity } = arrive(t)
  if (t < 1.6)
    return {
      active: 0,
      packet: { z, height: PLAIN, opacity, state: 'plain' },
      error: false,
      status: write.call
    }
  if (t < 2.4) {
    const fall = lerp(topOf(0), topOf(1), span(t, 1.6, 2.4))
    return {
      active: t < 2.2 ? 0 : 1,
      packet: { z: fall, height: PLAIN, opacity: 1, state: 'plain' },
      error: false,
      status: write.call
    }
  }
  if (t < 3.6)
    return {
      active: 1,
      packet: { z: topOf(1), height: PLAIN, opacity: 1, state: t < 2.7 ? 'plain' : 'error' },
      error: t >= 2.7,
      status: write.parsed
    }
  const rise = span(t, 3.6, 4.6)
  return {
    active: rise > 0.55 ? 0 : 1,
    packet: {
      z: lerp(topOf(1), baseOf(0) - PLAIN - 16, rise),
      height: PLAIN,
      opacity: 1 - span(t, 4.3, 4.9),
      state: 'error'
    },
    error: rise < 0.55,
    status: write.end
  }
}
