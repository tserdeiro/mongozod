'use client'

import * as React from 'react'

import { LAYERS, LOOP, frameAt, type Frame, type Layer } from './flow'
import {
  HALF,
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

const PACKET = 12
const LANE: [number, number] = [24, 24]
const PIN_FOR = 7000
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
      data-layer={LAYERS[level].key}
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

function Packet({ packet }: { packet: NonNullable<Frame['packet']> }) {
  const box = boxOf(PACKET, packet.z, packet.height, LANE)
  return (
    <g className="ls-packet" data-state={packet.state} style={{ opacity: packet.opacity }}>
      <path className="ls-packet-left" d={box.left} />
      <path className="ls-packet-right" d={box.right} />
      <path className="ls-packet-top" d={box.top} />
      <path className="ls-packet-edge" d={box.outline + box.crease} />
    </g>
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
 * that fits is stored, one that does not stops at Zod. Picking a layer from the list pins it.
 */
export function LayerStack() {
  const [time, setTime] = React.useState(0)
  const [pinned, setPinned] = React.useState<Layer | undefined>(undefined)
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

  React.useEffect(() => {
    if (pinned === undefined) return undefined
    const timer = window.setTimeout(() => setPinned(undefined), PIN_FOR)
    return () => window.clearTimeout(timer)
  }, [pinned])

  const flow = frameAt(time)
  const frame: Frame =
    pinned === undefined ? flow : { active: pinned, error: false, status: LAYERS[pinned].body }
  const slot = frame.packet ? slotOf(frame.packet.z) : -1
  const packet = frame.packet ? <Packet packet={frame.packet} /> : null

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
          {LAYERS.map((layer) => (
            <linearGradient key={layer.key} id={`ls-tint-${layer.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="ls-stop" data-layer={layer.key} data-at="top" />
              <stop offset="1" className="ls-stop" data-layer={layer.key} data-at="bottom" />
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
      </svg>
      <ol className="ls-steps">
        {LAYERS.map((layer, level) => (
          <li key={layer.key}>
            <button
              type="button"
              className="ls-step"
              data-layer={layer.key}
              aria-pressed={frame.active === level}
              onClick={() => setPinned(pinned === layer.level ? undefined : layer.level)}
            >
              <span className="ls-step-index">0{level + 1}</span>
              <span className="ls-step-name">{layer.name}</span>
              <span className="ls-step-role">{layer.role}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="ls-status" data-error={frame.error ? '' : undefined}>
        {frame.status}
      </p>
    </div>
  )
}
