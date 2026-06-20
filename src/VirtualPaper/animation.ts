import type { VirtualPaperTransform } from './types'

type SpringAnimationOptions = {
  readonly from: VirtualPaperTransform
  readonly to: VirtualPaperTransform
  readonly onUpdate: (transform: VirtualPaperTransform) => void
  readonly onComplete?: () => void
}

type SpringVector = {
  readonly x: number
  readonly y: number
  readonly scale: number
}

const SPRING_STIFFNESS = 0.18
const SPRING_DAMPING = 0.72
const SPRING_REST_DELTA = 0.25
const SPRING_REST_VELOCITY = 0.25

const getAxisDistance = (from: VirtualPaperTransform, to: VirtualPaperTransform): SpringVector => ({
  x: Math.abs(from.x - to.x),
  y: Math.abs(from.y - to.y),
  scale: Math.abs(from.scale - to.scale)
})

const isSpringAtRest = (
  current: VirtualPaperTransform,
  target: VirtualPaperTransform,
  velocity: SpringVector
): boolean => {
  const distance = getAxisDistance(current, target)

  return distance.x <= SPRING_REST_DELTA &&
    distance.y <= SPRING_REST_DELTA &&
    distance.scale <= SPRING_REST_DELTA &&
    Math.abs(velocity.x) <= SPRING_REST_VELOCITY &&
    Math.abs(velocity.y) <= SPRING_REST_VELOCITY &&
    Math.abs(velocity.scale) <= SPRING_REST_VELOCITY
}

export const createSpringAnimation = ({
  from,
  to,
  onUpdate,
  onComplete
}: SpringAnimationOptions): (() => void) => {
  let current = from
  let velocity: SpringVector = { x: 0, y: 0, scale: 0 }
  let frameId: number | null = null
  let cancelled = false

  const finish = () => {
    onUpdate(to)
    onComplete?.()
  }

  const step = () => {
    if (cancelled) return

    const nextVelocity = {
      x: (velocity.x + (to.x - current.x) * SPRING_STIFFNESS) * SPRING_DAMPING,
      y: (velocity.y + (to.y - current.y) * SPRING_STIFFNESS) * SPRING_DAMPING,
      scale: (velocity.scale + (to.scale - current.scale) * SPRING_STIFFNESS) * SPRING_DAMPING
    }
    const next = {
      x: current.x + nextVelocity.x,
      y: current.y + nextVelocity.y,
      scale: current.scale + nextVelocity.scale
    }

    current = next
    velocity = nextVelocity

    if (isSpringAtRest(current, to, velocity)) {
      finish()
      return
    }

    onUpdate(current)
    frameId = window.requestAnimationFrame(step)
  }

  frameId = window.requestAnimationFrame(step)

  return () => {
    cancelled = true
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
  }
}
