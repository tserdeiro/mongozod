// The stack in an isometric view: x and y on the plate, z up. A plate is a square slab; the
// projection puts +x down to the right and +y down to the left, like the plates in the drawing.

export const WIDTH = 320
export const HEIGHT = 484
const CENTER_X = WIDTH / 2
const CENTER_Y = 400
const COS = Math.cos(Math.PI / 6)

/** Half the side of a plate, its thickness and the height between two plates. */
export const HALF = 66
export const THICK = 12
export const GAP = 150

export type Point = [x: number, y: number, z: number]

export const iso = ([x, y, z]: Point): [number, number] => [
  CENTER_X + (x - y) * COS,
  CENTER_Y + (x + y) / 2 - z
]

const fixed = (value: number) => Math.round(value * 10) / 10

export const pathOf = (points: Point[], closed = true) =>
  points
    .map((point, index) => {
      const [x, y] = iso(point)
      return `${index ? 'L' : 'M'}${fixed(x)} ${fixed(y)}`
    })
    .join('') + (closed ? 'Z' : '')

/** The z of the bottom of plate `level`, counted from the top plate. */
export const baseOf = (level: number) => (2 - level) * GAP

export const topOf = (level: number) => baseOf(level) + THICK

/** The faces of a square box of half side `half` from `z` to `z + height`, centred on `at`. */
export function boxOf(
  half: number,
  z: number,
  height: number,
  at: [x: number, y: number] = [0, 0]
) {
  const top = z + height
  const [x0, x1, y0, y1] = [at[0] - half, at[0] + half, at[1] - half, at[1] + half]
  return {
    top: pathOf([
      [x0, y0, top],
      [x1, y0, top],
      [x1, y1, top],
      [x0, y1, top]
    ]),
    right: pathOf([
      [x1, y0, top],
      [x1, y1, top],
      [x1, y1, z],
      [x1, y0, z]
    ]),
    left: pathOf([
      [x1, y1, top],
      [x0, y1, top],
      [x0, y1, z],
      [x1, y1, z]
    ]),
    outline: pathOf([
      [x0, y0, top],
      [x1, y0, top],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
      [x0, y1, top]
    ]),
    crease: pathOf(
      [
        [x1, y0, top],
        [x1, y1, top],
        [x0, y1, top]
      ],
      false
    )
  }
}

/** Small chevrons at the four corners of a plate's top, pointing out of it. */
export function chevronsOf(z: number, inset = 12, arm = 5) {
  const corner = HALF - inset
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ]
    .map(([sx, sy]) =>
      pathOf(
        [
          [sx * (corner - arm), sy * corner, z],
          [sx * corner, sy * corner, z],
          [sx * corner, sy * (corner - arm), z]
        ],
        false
      )
    )
    .join('')
}

/** The SVG matrix that lays a drawing flat on the top of a plate at height `z`, centred. */
export const flatOn = (z: number) => {
  const [x, y] = iso([0, 0, z])
  return `matrix(${fixed(COS * 1000) / 1000} 0.5 ${-fixed(COS * 1000) / 1000} 0.5 ${fixed(x)} ${fixed(y)})`
}
