import { useEffect, useRef } from 'react'
import {
  clampReaderTransform,
  clampScale,
  convertLayoutToTransform
} from './transform'
import {
  type VirtualPaperContentSize,
  VirtualPaperInteractionMode,
  type VirtualPaperReaderZoomPreviewUpdater,
  type VirtualPaperTransform,
  type VirtualPaperTransformUpdater
} from './types'

type ReaderTouchZoomOptions = {
  readonly wrapperRef: React.RefObject<HTMLDivElement | null>
  readonly enabled: boolean
  readonly transform: VirtualPaperTransform
  readonly minScale: number
  readonly maxScale: number
  readonly contentSize?: VirtualPaperContentSize
  readonly previewReaderZoom?: VirtualPaperReaderZoomPreviewUpdater
  readonly endTransform: VirtualPaperTransformUpdater
}

type TouchPoint = {
  readonly x: number
  readonly y: number
}

type ZoomSegment = {
  readonly startTransform: VirtualPaperTransform
  readonly startMidpoint: TouchPoint
  readonly startDistance: number
  readonly firstIdentifier: number
  readonly secondIdentifier: number
}

const readTouchPair = (
  touches: TouchList,
  wrapper: HTMLDivElement,
  identifiers?: {
    readonly firstIdentifier: number
    readonly secondIdentifier: number
  }
): {
  readonly midpoint: TouchPoint
  readonly distance: number
  readonly firstIdentifier: number
  readonly secondIdentifier: number
} | null => {
  if (touches.length < 2) return null

  const activeTouches = Array.from(touches)
  const pair = identifiers
    ? [
        activeTouches.find(
          (touch) => touch.identifier === identifiers.firstIdentifier
        ),
        activeTouches.find(
          (touch) => touch.identifier === identifiers.secondIdentifier
        )
      ]
    : activeTouches
        .sort((left, right) => left.identifier - right.identifier)
        .slice(0, 2)
  const first = pair[0]
  const second = pair[1]
  if (!first || !second) return null

  const rect = wrapper.getBoundingClientRect()
  const firstPoint = {
    x: first.clientX - rect.left,
    y: first.clientY - rect.top
  }
  const secondPoint = {
    x: second.clientX - rect.left,
    y: second.clientY - rect.top
  }

  return {
    midpoint: {
      x: (firstPoint.x + secondPoint.x) / 2,
      y: (firstPoint.y + secondPoint.y) / 2
    },
    distance: Math.hypot(
      secondPoint.x - firstPoint.x,
      secondPoint.y - firstPoint.y
    ),
    firstIdentifier: first.identifier,
    secondIdentifier: second.identifier
  }
}

export function useReaderTouchZoom({
  wrapperRef,
  enabled,
  transform,
  minScale,
  maxScale,
  contentSize,
  previewReaderZoom,
  endTransform
}: ReaderTouchZoomOptions): void {
  const transformRef = useRef(transform)
  const minScaleRef = useRef(minScale)
  const maxScaleRef = useRef(maxScale)
  const contentSizeRef = useRef(contentSize)
  const previewReaderZoomRef = useRef(previewReaderZoom)
  const endTransformRef = useRef(endTransform)
  const segmentRef = useRef<ZoomSegment | null>(null)

  // 缩放预览会触发 React 重渲染；手势期间不能用尚未提交的 prop 覆盖最新姿态。
  if (segmentRef.current === null) transformRef.current = transform
  minScaleRef.current = minScale
  maxScaleRef.current = maxScale
  contentSizeRef.current = contentSize
  previewReaderZoomRef.current = previewReaderZoom
  endTransformRef.current = endTransform

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!enabled || !wrapper) return

    let previewFrameId: number | null = null
    let pendingPreview: {
      readonly transform: VirtualPaperTransform
      readonly origin: TouchPoint
    } | null = null

    const cancelPendingPreview = () => {
      if (previewFrameId !== null) {
        cancelAnimationFrame(previewFrameId)
        previewFrameId = null
      }
      pendingPreview = null
    }

    const schedulePreview = (
      nextTransform: VirtualPaperTransform,
      origin: TouchPoint
    ) => {
      pendingPreview = { transform: nextTransform, origin }
      if (previewFrameId !== null) return

      previewFrameId = requestAnimationFrame(() => {
        previewFrameId = null
        const preview = pendingPreview
        pendingPreview = null
        if (!preview) return

        previewReaderZoomRef.current?.(preview, {
          source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
          inputType: 'pointer',
          phase: 'change',
          originalEventType: 'touchmove'
        })
      })
    }

    const startSegment = (touches: TouchList) => {
      const pair = readTouchPair(touches, wrapper)
      if (!pair || pair.distance <= 0) return

      const currentTransform = transformRef.current
      const currentContentSize = contentSizeRef.current
      const startTransform = currentContentSize
        ? clampReaderTransform(
            convertLayoutToTransform(
              currentContentSize.width * currentTransform.scale,
              currentContentSize.height * currentTransform.scale,
              wrapper.scrollLeft,
              wrapper.scrollTop,
              currentTransform.scale
            ),
            currentContentSize,
            wrapper.clientWidth,
            wrapper.clientHeight
          )
        : currentTransform

      segmentRef.current = {
        startTransform: { ...startTransform },
        startMidpoint: pair.midpoint,
        startDistance: pair.distance,
        firstIdentifier: pair.firstIdentifier,
        secondIdentifier: pair.secondIdentifier
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (segmentRef.current === null && event.touches.length >= 2) {
        startSegment(event.touches)
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      const segment = segmentRef.current
      if (!segment) return

      const pair = readTouchPair(event.touches, wrapper, segment)
      if (!pair) return

      const nextScale = clampScale(
        segment.startTransform.scale * (pair.distance / segment.startDistance),
        minScaleRef.current,
        maxScaleRef.current
      )
      const contentX =
        (segment.startMidpoint.x - segment.startTransform.x) /
        segment.startTransform.scale
      const contentY =
        (segment.startMidpoint.y - segment.startTransform.y) /
        segment.startTransform.scale
      let nextTransform: VirtualPaperTransform = {
        x: pair.midpoint.x - contentX * nextScale,
        y: pair.midpoint.y - contentY * nextScale,
        scale: nextScale
      }

      const currentContentSize = contentSizeRef.current
      if (currentContentSize) {
        nextTransform = clampReaderTransform(
          nextTransform,
          currentContentSize,
          wrapper.clientWidth,
          wrapper.clientHeight
        )
      }

      transformRef.current = nextTransform
      schedulePreview(nextTransform, segment.startMidpoint)
    }

    const finishOrRestartSegment = (event: TouchEvent) => {
      if (segmentRef.current === null) return

      if (event.touches.length >= 2) {
        const currentPair = readTouchPair(event.touches, wrapper, segmentRef.current)
        if (currentPair) return
        startSegment(event.touches)
        return
      }

      cancelPendingPreview()
      segmentRef.current = null
      endTransformRef.current(transformRef.current, {
        source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
        inputType: 'pointer',
        phase: 'end',
        originalEventType: event.type
      })
    }

    // passive 监听器不阻止浏览器接管单指滚动，因此保留系统惯性。
    wrapper.addEventListener('touchstart', handleTouchStart, { passive: true })
    wrapper.addEventListener('touchmove', handleTouchMove, { passive: true })
    wrapper.addEventListener('touchend', finishOrRestartSegment, {
      passive: true
    })
    wrapper.addEventListener('touchcancel', finishOrRestartSegment, {
      passive: true
    })

    return () => {
      cancelPendingPreview()
      segmentRef.current = null
      wrapper.removeEventListener('touchstart', handleTouchStart)
      wrapper.removeEventListener('touchmove', handleTouchMove)
      wrapper.removeEventListener('touchend', finishOrRestartSegment)
      wrapper.removeEventListener('touchcancel', finishOrRestartSegment)
    }
  }, [enabled, wrapperRef])
}
