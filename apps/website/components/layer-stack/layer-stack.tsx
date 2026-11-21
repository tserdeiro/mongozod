'use client'

import * as React from 'react'

import { CARD, LAYERS, LOOP, frameAt, type Frame, type Layer, type Packet } from './flow'
import {
  HALF,
  iso,
  HEIGHT,
  THICK,
  WIDTH,
  baseOf,
  boxOf,
  chevronsOf,
  flatOn,
  pathOf,
  topOf
} from './geometry'
import { mongodbPath, zodPath } from './logos'

const PACKET = 13
const LANE: [number, number] = [24, 24]
const CORNER = HALF - 22

const plates = LAYERS.map((_, level) => boxOf(HALF, baseOf(level), THICK))

// Dashed lines from the bottom of each plate to the top of the next, at four inner corners.
const links = [0, 1].map((level) =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ]
    .map(([sx, sy]) =>
      pathOf(
        [
          [sx * CORNER, sy * CORNER, baseOf(level)],
          [sx * CORNER, sy * CORNER, topOf(level + 1)]
        ],
        false
      )
    )
    .join('')
)

function Mark({ level }: { level: Layer }) {
  const transform = `${flatOn(topOf(level))} translate(-18 -18)`
  if (level === 0)
    return (
      <text
        className="ls-wordmark"
        transform={transform}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
      >
        MongoZod
      </text>
    )
  return (
    <path
      className="ls-mark"
      transform={`${transform} translate(-17 -17) scale(1.42)`}
      d={level === 1 ? zodPath : mongodbPath}
    />
  )
}

function Plate({ level, frame }: { level: Layer; frame: Frame }) {
  const paths = plates[level]
  const top = topOf(level)
  const lit = frame.active === level
  return (
    <g
      className="ls-plate"
      data-layer={LAYERS[level]}
      data-lit={lit ? '' : undefined}
      data-error={level === 1 && frame.error ? '' : undefined}
    >
      <path className="ls-glow" d={paths.top + paths.left + paths.right} />
      <path className="ls-side" data-side="left" d={paths.left} />
      <path className="ls-side" data-side="right" d={paths.right} />
      <path className="ls-tint" data-side="left" d={paths.left} />
      <path className="ls-tint" data-side="right" d={paths.right} />
      <path className="ls-top" d={paths.top} />
      <path className="ls-crease" d={paths.crease} />
      <path className="ls-inset" d={boxOf(HALF - 10, top - 0.01, 0.01).top} />
      <path className="ls-chevrons" d={chevronsOf(top)} />
      <Mark level={level} />
      <path className="ls-edge" d={paths.outline} />
    </g>
  )
}

// The card's rows, one per field of `postSchema`, as lines of different lengths on its top.
const ROW_Y = [-7.5, -2.5, 2.5, 7.5]
const ROW_LENGTH = [14, 18, 10, 13]

function Card({ packet }: { packet: Packet }) {
  const top = packet.z + CARD
  const box = boxOf(PACKET, packet.z, CARD, LANE)
  return (
    <g className="ls-packet" data-state={packet.state} style={{ opacity: packet.opacity }}>
      <path className="ls-packet-left" d={box.left} />
      <path className="ls-packet-right" d={box.right} />
      <path className="ls-packet-top" d={box.top} />
      <path className="ls-packet-edge" d={box.outline + box.crease} />
      {packet.fields.map((field, index) => {
        const length = ROW_LENGTH[index] * (field === 'default' ? packet.filled : 1)
        const x = LANE[0] - PACKET + 4
        const row = LANE[1] + ROW_Y[index]
        return length > 0.5 ? (
          <path
            key={index}
            className="ls-row"
            data-field={field}
            d={pathOf(
              [
                [x, row, top],
                [x + length, row, top]
              ],
              false
            )}
          />
        ) : null
      })}
    </g>
  )
}

/** The tag beside the card, drawn over every plate so none hides it while the card falls. */
function Label({ packet }: { packet: Packet }) {
  const [x, y] = iso([LANE[0] + PACKET, LANE[1] - PACKET, packet.z + CARD])
  return (
    <text
      className="ls-label"
      data-state={packet.state}
      x={x + 8}
      y={y + 3}
      style={{ opacity: packet.opacity }}
    >
      {packet.label}
    </text>
  )
}

/** Which gap the packet is drawn in: 0 above the top plate, 3 sunk into the bottom one. */
function slotOf(z: number) {
  if (z >= topOf(0) - 0.01) return 0
  if (z >= topOf(1) - 0.01) return 1
  if (z >= topOf(2) - 0.01) return 2
  return 3
}

/**
 * The home page stack: MongoZod on Zod on the MongoDB driver. A write runs down it on a loop; one
 * that fits is stored, one that does not stops at Zod.
 */
export function LayerStack() {
  const [time, setTime] = React.useState(0)
  const root = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTime(2.4 + 0.8)
      return undefined
    }
    let frame = 0
    let visible = true
    let last = 0
    let clock = 0
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
    })
    if (root.current) observer.observe(root.current)
    const tick = (now: number) => {
      const step = last ? Math.min((now - last) / 1000, 1 / 20) : 0
      last = now
      if (visible) {
        clock = (clock + step) % LOOP
        setTime(clock)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const frame = frameAt(time)
  const slot = frame.packet ? slotOf(frame.packet.z) : -1
  const packet = frame.packet ? <Card packet={frame.packet} /> : null

  return (
    <div ref={root} className="ls">
      <svg
        className="ls-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="MongoZod sits on Zod, which sits on the official MongoDB driver. A write goes down through the three layers: Zod validates it and fills its defaults, and only a write that fits reaches MongoDB."
      >
        <defs>
          <pattern id="ls-dots" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" className="ls-dot" />
          </pattern>
          {LAYERS.map((key) => (
            <linearGradient key={key} id={`ls-tint-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="ls-stop" data-layer={key} data-at="top" />
              <stop offset="1" className="ls-stop" data-layer={key} data-at="bottom" />
            </linearGradient>
          ))}
        </defs>
        <rect className="ls-grid" x="0" y="0" width={WIDTH} height={HEIGHT} fill="url(#ls-dots)" />
        {slot === 3 ? packet : null}
        <Plate level={2} frame={frame} />
        <path
          className="ls-link"
          data-on={frame.active === 1 || frame.active === 2 ? '' : undefined}
          d={links[1]}
        />
        {slot === 2 ? packet : null}
        <Plate level={1} frame={frame} />
        <path
          className="ls-link"
          data-on={frame.active === 0 || frame.active === 1 ? '' : undefined}
          d={links[0]}
        />
        {slot === 1 ? packet : null}
        <Plate level={0} frame={frame} />
        {slot === 0 ? packet : null}
        {frame.packet ? <Label packet={frame.packet} /> : null}
      </svg>
      <p className="ls-status" data-tone={frame.tone}>
        {frame.status}
      </p>
    </div>
  )
}
