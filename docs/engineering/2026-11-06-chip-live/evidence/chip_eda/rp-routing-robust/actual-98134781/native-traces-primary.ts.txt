import { BooleanOperations, Matrix, type Polygon } from "@flatten-js/core"
import type { LayerRef, PcbTrace } from "circuit-json"
import { circle, ring, stroke, withHoles, positive, type XY } from "./geometry"
import { spanLayers } from "./layers"

type TraceSegment = {
  start: XY
  end: XY
  layer: string
  startWidth: number
  endWidth: number
}
const samePoint = (a: XY, b: XY) => a.x === b.x && a.y === b.y
const unit = (x: number, y: number) => {
  const length = Math.hypot(x, y)
  return length ? { x: x / length, y: y / length } : { x: 1, y: 0 }
}

/** Interpolated traces use flat caps and averaged directions at bends. */
function interpolatedPolygon(segments: TraceSegment[]): Polygon {
  const points = [
    { ...segments[0].start, width: segments[0].startWidth },
    ...segments.map((s) => ({ ...s.end, width: s.endWidth })),
  ]
  const directions = segments.map((s) =>
    unit(s.end.x - s.start.x, s.end.y - s.start.y),
  )
  const left: XY[] = [],
    right: XY[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    positive(p.width, "interpolated trace width")
    const before = directions[Math.max(0, i - 1)],
      after = directions[Math.min(i, directions.length - 1)]
    const d = unit(before.x + after.x, before.y + after.y)
    const nx = (-d.y * p.width) / 2,
      ny = (d.x * p.width) / 2
    left.push({ x: p.x + nx, y: p.y + ny })
    right.push({ x: p.x - nx, y: p.y - ny })
  }
  return ring([...left, ...right.reverse()])
}

/** Subtract PCB-world (X right, Y up, millimeters) drill geometry.
 * FlattenJS uses an absolute comparison tolerance. Very short routed segments
 * can place intersections within that tolerance and cause a boundary conflict.
 * Retry in micrometers, then return to millimeters, without changing global
 * FlattenJS tolerance or approximating the copper outline.
 */
function subtractDrill(shape: Polygon, hole: Polygon): Polygon {
  try {
    return BooleanOperations.subtract(shape, hole)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Unresolved boundary conflict in boolean operation"
    )
      throw error
    const toMicrometers = new Matrix(1000, 0, 0, 1000, 0, 0)
    const toMillimeters = new Matrix(0.001, 0, 0, 0.001, 0, 0)
    return BooleanOperations.subtract(
      shape.transform(toMicrometers),
      hole.transform(toMicrometers),
    ).transform(toMillimeters)
  }
}

export function traceGeometry(
  trace: PcbTrace,
  stack: readonly LayerRef[],
  includeDrill: boolean,
): Map<string, Polygon[]> {
  const result = new Map<string, Polygon[]>()
  const drills = new Map<string, Polygon[]>()
  const segments: TraceSegment[] = []
  const add = (layer: string, shape: Polygon) =>
    result.set(layer, [...(result.get(layer) ?? []), shape])
  for (const p of trace.route) {
    if (p.route_type === "via") {
      const legacy = p as typeof p & {
        via_diameter?: number
        via_hole_diameter?: number
      }
      const outerDiameter = p.outer_diameter ?? legacy.via_diameter
      if (outerDiameter === undefined) continue
      const holeDiameter = p.hole_diameter ?? legacy.via_hole_diameter
      const shape = circle(p, outerDiameter / 2)
      const drill =
        includeDrill && holeDiameter ? circle(p, holeDiameter / 2) : undefined
      for (const layer of spanLayers([p.from_layer, p.to_layer], stack)) {
        add(layer, drill ? withHoles(shape, [drill]) : shape)
        if (drill) drills.set(layer, [...(drills.get(layer) ?? []), drill])
      }
    }
    if (p.route_type === "through_pad") {
      for (const layer of new Set([p.start_layer, p.end_layer]))
        add(layer, stroke(p.start, p.end, p.width))
    }
  }
  for (let i = 0; i < trace.route.length - 1; i++) {
    const a = trace.route[i],
      b = trace.route[i + 1]
    const start = a.route_type === "through_pad" ? a.end : a
    const end = b.route_type === "through_pad" ? b.start : b
    if (samePoint(start, end)) continue
    // Via from/to fields describe its span, not the direction of route traversal.
    const startLayers =
      a.route_type === "wire"
        ? [a.layer]
        : a.route_type === "via"
          ? spanLayers([a.from_layer, a.to_layer], stack)
          : [a.end_layer]
    const endLayers =
      b.route_type === "wire"
        ? [b.layer]
        : b.route_type === "via"
          ? spanLayers([b.from_layer, b.to_layer], stack)
          : [b.start_layer]
    const sharedLayers = startLayers.filter((layer) =>
      endLayers.includes(layer as never),
    )
    if (sharedLayers.length !== 1)
      throw new Error(
        `Cannot determine one wire layer between route points ${i} and ${i + 1}`,
      )
    const startLayer = sharedLayers[0]
    const width = "width" in a ? a.width : "width" in b ? b.width : undefined
    if (width === undefined || samePoint(start, end)) continue
    segments.push({
      start,
      end,
      layer: startLayer,
      startWidth: width,
      endWidth: "width" in b ? b.width : width,
    })
  }
  if (trace.route_thickness_mode === "interpolated") {
    let group: TraceSegment[] = []
    const flush = () => {
      if (group.length) {
        add(group[0].layer, interpolatedPolygon(group))
        group = []
      }
    }
    for (const segment of segments) {
      const last = group.at(-1)
      if (
        last &&
        (last.layer !== segment.layer ||
          !samePoint(last.end, segment.start) ||
          last.endWidth !== segment.startWidth)
      )
        flush()
      group.push(segment)
    }
    flush()
  } else
    for (const s of segments) add(s.layer, stroke(s.start, s.end, s.startWidth))
  // Drilling removes material from the adjoining wire as well as the annular pad.
  for (const [layer, holes] of drills) {
    result.set(
      layer,
      result
        .get(layer)!
        .map((shape) =>
          holes.reduce((shape, hole) => subtractDrill(shape, hole), shape),
        )
        .filter((shape) => shape.faces.size > 0),
    )
  }
  return result
}
