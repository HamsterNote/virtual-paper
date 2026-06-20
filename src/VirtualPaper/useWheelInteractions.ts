import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  applyElasticContainResistance,
  applyZoomAnchor,
  clampReaderTransform,
  clampScale,
  computeReaderLayoutMetrics,
  convertReaderLayoutToTransform,
  validateReaderModeZoomDebounceMs
} from './transform'
import { measureContainBox, projectContainTransformForElements } from './containMode'
import { createElasticSettleController } from './elasticSettle'
import {
  type VirtualPaperContentSize,
  type UseVirtualPaperInteractionArgs,
  type VirtualPaperTransform,
  type VirtualPaperTransformMeta,
  VirtualPaperInteractionMode
} from './types'

const WHEEL_END_DEBOUNCE_MS = 150
const WHEEL_ZOOM_SENSITIVITY = 0.002

type WheelEndState = {
  transform: VirtualPaperTransform
  source: VirtualPaperInteractionMode
  settleFrom?: VirtualPaperTransform
}

type ReaderWheelZoomTransformInput = {
  readonly event: WheelEvent
  readonly wrapper: HTMLDivElement
  readonly contentSize: VirtualPaperContentSize
  readonly current: VirtualPaperTransform
  readonly minScale: number
  readonly maxScale: number
}

const createWheelMeta = (
  source: VirtualPaperInteractionMode,
  phase: VirtualPaperTransformMeta['phase']
): VirtualPaperTransformMeta => ({
  source,
  inputType: 'wheel',
  phase
})

const getWheelZoomTransform = (
  event: WheelEvent,
  wrapper: HTMLDivElement,
  current: VirtualPaperTransform,
  minScale: number,
  maxScale: number
): VirtualPaperTransform => {
  const wrapperRect = wrapper.getBoundingClientRect()
  const localX = event.clientX - wrapperRect.left
  const localY = event.clientY - wrapperRect.top
  const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY)
  const nextScale = clampScale(current.scale * zoomFactor, minScale, maxScale)

  return applyZoomAnchor(current, nextScale, localX, localY)
}

const getReaderWheelZoomTransform = ({
  event,
  wrapper,
  contentSize,
  current,
  minScale,
  maxScale
}: ReaderWheelZoomTransformInput): VirtualPaperTransform => {
  const wrapperWidth = wrapper.clientWidth
  const wrapperHeight = wrapper.clientHeight
  const wrapperRect = wrapper.getBoundingClientRect()
  const localX = event.clientX - wrapperRect.left
  const localY = event.clientY - wrapperRect.top
  const currentMetrics = computeReaderLayoutMetrics(
    contentSize,
    current.scale,
    wrapperWidth,
    wrapperHeight,
    current
  )
  const contentX = (currentMetrics.scrollLeft + localX - currentMetrics.offsetX) / current.scale
  const contentY = (currentMetrics.scrollTop + localY - currentMetrics.offsetY) / current.scale
  const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY)
  const nextScale = clampScale(current.scale * zoomFactor, minScale, maxScale)
  const nextMetrics = computeReaderLayoutMetrics(
    contentSize,
    nextScale,
    wrapperWidth,
    wrapperHeight,
    { x: 0, y: 0, scale: nextScale }
  )
  const desiredScrollLeft = contentX * nextScale + nextMetrics.offsetX - localX
  const desiredScrollTop = contentY * nextScale + nextMetrics.offsetY - localY
  const clampedScrollLeft = Math.min(
    Math.max(desiredScrollLeft, 0),
    nextMetrics.maxScrollLeft
  )
  const clampedScrollTop = Math.min(
    Math.max(desiredScrollTop, 0),
    nextMetrics.maxScrollTop
  )

  return convertReaderLayoutToTransform(
    contentSize,
    nextScale,
    wrapperWidth,
    wrapperHeight,
    clampedScrollLeft,
    clampedScrollTop
  )
}

export function useWheelInteractions(args: UseVirtualPaperInteractionArgs): void {
  const latestArgsRef = useRef(args)
  const wheelEndTimerRef = useRef<number | null>(null)
  const wheelEndStateRef = useRef<WheelEndState | null>(null)
  const settleCancelRef = useRef<(() => void) | null>(null)
  const elasticActiveRefRef = useRef(args.elasticActiveRef)
  const updateTransformRef = useRef(args.updateTransform)
  const endTransformRef = useRef(args.endTransform)

  latestArgsRef.current = args
  elasticActiveRefRef.current = args.elasticActiveRef
  updateTransformRef.current = args.updateTransform
  endTransformRef.current = args.endTransform

  const {
    setElasticActive,
    cancelSettleAnimation,
    transformsMatch,
    settleElasticTransform
  } = useMemo(() => createElasticSettleController({
    elasticActiveRefRef,
    settleCancelRef,
    updateTransformRef,
    endTransformRef,
    emitInitialUpdate: false
  }), [])

  const finishWheelTransform = useCallback(() => {
    const wheelEndState = wheelEndStateRef.current

    if (!wheelEndState) {
      return
    }

    const endMeta = {
      source: wheelEndState.source,
      inputType: 'wheel' as const,
      phase: 'end' as const
    }
    if (wheelEndState.settleFrom && !transformsMatch(wheelEndState.settleFrom, wheelEndState.transform)) {
      settleElasticTransform(wheelEndState.settleFrom, wheelEndState.transform, endMeta)
    } else {
      setElasticActive(false)
      endTransformRef.current(wheelEndState.transform, endMeta)
    }
    wheelEndStateRef.current = null
    wheelEndTimerRef.current = null
  }, [setElasticActive, settleElasticTransform, transformsMatch])

  const scheduleWheelEnd = useCallback(
    (
      transform: VirtualPaperTransform,
      source: VirtualPaperInteractionMode,
      debounceMs: number,
      settleFrom?: VirtualPaperTransform
    ) => {
      wheelEndStateRef.current = settleFrom
        ? { transform, source, settleFrom }
        : { transform, source }

      if (wheelEndTimerRef.current !== null) {
        window.clearTimeout(wheelEndTimerRef.current)
      }

      if (debounceMs === 0) {
        finishWheelTransform()
        return
      }

      wheelEndTimerRef.current = window.setTimeout(finishWheelTransform, debounceMs)
    },
    [finishWheelTransform]
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const {
        wrapperRef,
        containerRef,
        contentSize,
        transform,
        enabledInteractions,
        minScale,
        maxScale,
        updateTransform,
        isReaderMode,
        containMode,
        edgeElasticScroll,
        readerModeZoomDebounceMs
      } = latestArgsRef.current
      const wrapper = wrapperRef.current
      const hasInteraction = (mode: VirtualPaperInteractionMode) => {
        return enabledInteractions.includes(mode)
      }

      if (isReaderMode && !event.ctrlKey && !event.metaKey) {
        return
      }

      let nextTransform: VirtualPaperTransform | null = null
      let source: VirtualPaperInteractionMode | null = null

      if (event.ctrlKey || event.metaKey) {
        if (hasInteraction(VirtualPaperInteractionMode.MouseWheelCtrlZoom) && wrapper) {
          source = VirtualPaperInteractionMode.MouseWheelCtrlZoom
          nextTransform = isReaderMode && contentSize
            ? getReaderWheelZoomTransform({
                event,
                wrapper,
                contentSize,
                current: transform,
                minScale,
                maxScale
              })
            : getWheelZoomTransform(
                event,
                wrapper,
                transform,
                minScale,
                maxScale
              )
        }
      } else if (hasInteraction(VirtualPaperInteractionMode.TrackpadScrollPan)) {
        source = VirtualPaperInteractionMode.TrackpadScrollPan
        nextTransform = {
          x: transform.x - event.deltaX,
          y: transform.y - event.deltaY,
          scale: transform.scale
        }
      } else if (hasInteraction(VirtualPaperInteractionMode.MouseWheelZoom) && wrapper) {
        source = VirtualPaperInteractionMode.MouseWheelZoom
        nextTransform = getWheelZoomTransform(
          event,
          wrapper,
          transform,
          minScale,
          maxScale
        )
      }

      if (!source || !nextTransform) {
        return
      }

      if (isReaderMode && contentSize && wrapper) {
        nextTransform = clampReaderTransform(
          nextTransform,
          contentSize,
          wrapper.clientWidth,
          wrapper.clientHeight
        )
      }

      cancelSettleAnimation()

      let settleFrom: VirtualPaperTransform | undefined
      let wheelEndTransform = nextTransform
      if (containMode && !isReaderMode && wrapper && containerRef.current) {
        if (source === VirtualPaperInteractionMode.TrackpadScrollPan && edgeElasticScroll) {
          const box = measureContainBox(wrapper, containerRef.current, nextTransform.scale)
          if (box) {
            const elasticResult = applyElasticContainResistance({
              transform: nextTransform,
              containerSize: { width: box.containerWidth, height: box.containerHeight },
              wrapperSize: { width: box.wrapperWidth, height: box.wrapperHeight },
              enabled: true
            })
            nextTransform = elasticResult.elasticTransform
            wheelEndTransform = elasticResult.targetTransform
            if (!transformsMatch(elasticResult.elasticTransform, elasticResult.targetTransform)) {
              settleFrom = elasticResult.elasticTransform
              setElasticActive(true)
            } else {
              setElasticActive(false)
            }
          } else {
            setElasticActive(false)
          }
        } else {
          setElasticActive(false)
          nextTransform = projectContainTransformForElements(nextTransform, wrapper, containerRef.current)
          wheelEndTransform = nextTransform
        }
      } else {
        setElasticActive(false)
      }

      event.preventDefault()
      updateTransform(nextTransform, createWheelMeta(source, 'change'))
      scheduleWheelEnd(
        wheelEndTransform,
        source,
        isReaderMode
          ? validateReaderModeZoomDebounceMs(readerModeZoomDebounceMs)
          : WHEEL_END_DEBOUNCE_MS,
        settleFrom
      )
    },
    [cancelSettleAnimation, scheduleWheelEnd, setElasticActive, transformsMatch]
  )

  useEffect(() => {
    const { containMode, edgeElasticScroll, enabledInteractions, isReaderMode } = args
    const trackpadEnabled = enabledInteractions.includes(VirtualPaperInteractionMode.TrackpadScrollPan)

    if (!containMode || !edgeElasticScroll || isReaderMode || !trackpadEnabled) {
      cancelSettleAnimation()
      if (wheelEndTimerRef.current !== null) {
        window.clearTimeout(wheelEndTimerRef.current)
        wheelEndTimerRef.current = null
      }
      wheelEndStateRef.current = null
    }
  }, [
    args.containMode,
    args.edgeElasticScroll,
    args.enabledInteractions,
    args.isReaderMode,
    cancelSettleAnimation
  ])

  useEffect(() => {
    const wrapper = latestArgsRef.current.wrapperRef.current

    if (!wrapper) {
      return
    }

    wrapper.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      wrapper.removeEventListener('wheel', handleWheel)

      if (wheelEndTimerRef.current !== null) {
        window.clearTimeout(wheelEndTimerRef.current)
        wheelEndTimerRef.current = null
      }
      cancelSettleAnimation()
    }
  }, [cancelSettleAnimation, handleWheel])
}
