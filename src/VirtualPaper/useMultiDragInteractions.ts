import { useEffect, useRef } from 'react'
import {
  DragOperationType,
  Mixin,
  MixinType,
  type Finger,
  type Options,
  type Pose
} from '@system-ui-js/multi-drag'
import { clampScale } from './transform'
import {
  type UseVirtualPaperInteractionArgs,
  type VirtualPaperInteractionMode as VirtualPaperInteractionModeType,
  type VirtualPaperTransform,
  VirtualPaperInteractionMode
} from './types'

type PointerModeFlags = {
  mouseDragPan: boolean
  touchSingleFingerPan: boolean
  touchTwoFingerPan: boolean
  touchTwoFingerZoom: boolean
  penPan: boolean
}

type ActivePointerGesture = {
  panSource?: VirtualPaperInteractionModeType
  zoomSource?: VirtualPaperInteractionModeType
}

const SCALE_EPSILON = 0.000001

const getPointerModeFlags = (
  enabledInteractions: VirtualPaperInteractionModeType[]
): PointerModeFlags => ({
  mouseDragPan: enabledInteractions.includes(VirtualPaperInteractionMode.MouseDragPan),
  touchSingleFingerPan: enabledInteractions.includes(VirtualPaperInteractionMode.TouchSingleFingerPan),
  touchTwoFingerPan: enabledInteractions.includes(VirtualPaperInteractionMode.TouchTwoFingerPan),
  touchTwoFingerZoom: enabledInteractions.includes(VirtualPaperInteractionMode.TouchTwoFingerZoom),
  penPan: enabledInteractions.includes(VirtualPaperInteractionMode.PenPan)
})

const hasPointerModes = (flags: PointerModeFlags): boolean => {
  return flags.mouseDragPan ||
    flags.touchSingleFingerPan ||
    flags.touchTwoFingerPan ||
    flags.touchTwoFingerZoom ||
    flags.penPan
}

const getFingerEvent = (finger: Finger): PointerEvent | undefined => {
  return finger.getLastOperation()?.event
}

const isPointerEvent = (event: PointerEvent | undefined): event is PointerEvent => {
  return event !== undefined
}

const getActivePointerGesture = (
  fingers: Finger[],
  flags: PointerModeFlags
): ActivePointerGesture | null => {
  const events = fingers.map(getFingerEvent).filter(isPointerEvent)

  const hasPrimaryMouse = events.some((event) => {
    return event.pointerType === 'mouse' && event.isPrimary
  })
  if (hasPrimaryMouse) {
    return flags.mouseDragPan
      ? { panSource: VirtualPaperInteractionMode.MouseDragPan }
      : null
  }

  const hasPen = events.some((event) => event.pointerType === 'pen')
  if (hasPen) {
    return flags.penPan
      ? { panSource: VirtualPaperInteractionMode.PenPan }
      : null
  }

  const allTouch = fingers.length > 0 && events.length === fingers.length &&
    events.every((event) => event.pointerType === 'touch')

  if (fingers.length === 1 && allTouch) {
    return flags.touchSingleFingerPan
      ? { panSource: VirtualPaperInteractionMode.TouchSingleFingerPan }
      : null
  }

  if (fingers.length >= 2 && allTouch) {
    const gesture: ActivePointerGesture = {}

    if (flags.touchTwoFingerPan) {
      gesture.panSource = VirtualPaperInteractionMode.TouchTwoFingerPan
    }
    if (flags.touchTwoFingerZoom) {
      gesture.zoomSource = VirtualPaperInteractionMode.TouchTwoFingerZoom
    }

    return gesture.panSource || gesture.zoomSource ? gesture : null
  }

  return null
}

const getMixinTypes = (flags: PointerModeFlags): MixinType[] => {
  const mixinTypes: MixinType[] = []

  if (
    flags.mouseDragPan ||
    flags.touchSingleFingerPan ||
    flags.touchTwoFingerPan ||
    flags.penPan
  ) {
    mixinTypes.push(MixinType.Drag)
  }

  if (flags.touchTwoFingerZoom) {
    mixinTypes.push(MixinType.Scale)
  }

  return mixinTypes
}

const getSingleFingerMixinTypes = (flags: PointerModeFlags): MixinType[] => {
  if (flags.mouseDragPan || flags.touchSingleFingerPan || flags.penPan) {
    return [MixinType.Drag]
  }

  return []
}

const chooseGestureSource = (
  activeGesture: ActivePointerGesture | null,
  currentScale: number,
  nextScale: number
): VirtualPaperInteractionModeType | null => {
  if (!activeGesture) return null

  if (!activeGesture.panSource) {
    return activeGesture.zoomSource ?? null
  }

  if (!activeGesture.zoomSource) {
    return activeGesture.panSource
  }

  return Math.abs(nextScale - currentScale) > SCALE_EPSILON
    ? activeGesture.zoomSource
    : activeGesture.panSource
}

export function useMultiDragInteractions(args: UseVirtualPaperInteractionArgs): void {
  const {
    containerRef,
    transform,
    enabledInteractions,
    minScale,
    maxScale,
    updateTransform,
    endTransform
  } = args

  const transformRef = useRef(transform)
  const minScaleRef = useRef(minScale)
  const maxScaleRef = useRef(maxScale)
  const updateTransformRef = useRef(updateTransform)
  const endTransformRef = useRef(endTransform)
  const activeGestureRef = useRef<ActivePointerGesture | null>(null)

  transformRef.current = transform
  minScaleRef.current = minScale
  maxScaleRef.current = maxScale
  updateTransformRef.current = updateTransform
  endTransformRef.current = endTransform

  const flags = getPointerModeFlags(enabledInteractions)

  useEffect(() => {
    const element = containerRef.current
    if (!element || !hasPointerModes(flags)) return

    const getPose = (target: HTMLElement): Pose => {
      const rect = target.getBoundingClientRect()
      const current = transformRef.current

      return {
        position: { x: current.x, y: current.y },
        width: rect.width,
        height: rect.height,
        scale: current.scale
      }
    }

    const applyPose = (
      target: HTMLElement,
      pose: Partial<Pose>,
      phase: 'change' | 'end'
    ) => {
      const currentPose = getPose(target)
      const currentTransform = transformRef.current
      const nextPosition = pose.position ?? currentPose.position
      const nextScale = clampScale(
        pose.scale ?? currentPose.scale ?? currentTransform.scale,
        minScaleRef.current,
        maxScaleRef.current
      )
      const source = chooseGestureSource(
        activeGestureRef.current,
        currentPose.scale ?? currentTransform.scale,
        nextScale
      )

      if (!source) return

      const deltaX = nextPosition.x - currentPose.position.x
      const deltaY = nextPosition.y - currentPose.position.y
      const nextTransform: VirtualPaperTransform = {
        x: currentTransform.x + deltaX,
        y: currentTransform.y + deltaY,
        scale: nextScale
      }
      const meta = {
        source,
        inputType: 'pointer' as const,
        phase
      }

      if (phase === 'end') {
        endTransformRef.current(nextTransform, meta)
        return
      }

      updateTransformRef.current(nextTransform, meta)
    }

    const options: Options = {
      getPose,
      setPose: (target, pose) => applyPose(target, pose, 'change'),
      setPoseOnEnd: (target, pose) => applyPose(target, pose, 'end'),
      maxFingerCount: -1,
      inertial: false,
      passive: false
    }

    const mixin = new Mixin(
      element,
      options,
      getMixinTypes(flags),
      getSingleFingerMixinTypes(flags)
    )

    const trackGesture = (fingers: Finger[]) => {
      activeGestureRef.current = getActivePointerGesture(fingers, flags)
    }
    const clearGesture = () => {
      activeGestureRef.current = null
    }

    mixin.addEventListener(DragOperationType.Start, trackGesture)
    mixin.addEventListener(DragOperationType.Move, trackGesture)
    mixin.addEventListener(DragOperationType.AllEnd, clearGesture)

    return () => {
      activeGestureRef.current = null
      mixin.destroy()
    }
  }, [
    containerRef,
    flags.mouseDragPan,
    flags.touchSingleFingerPan,
    flags.touchTwoFingerPan,
    flags.touchTwoFingerZoom,
    flags.penPan
  ])
}
