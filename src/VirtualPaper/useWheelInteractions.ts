import { useCallback, useEffect, useRef } from 'react'

import { applyZoomAnchor, clampScale } from './transform'
import {
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

export function useWheelInteractions(args: UseVirtualPaperInteractionArgs): void {
  const latestArgsRef = useRef(args)
  const wheelEndTimerRef = useRef<number | null>(null)
  const wheelEndStateRef = useRef<WheelEndState | null>(null)

  latestArgsRef.current = args

  const finishWheelTransform = useCallback(() => {
    const wheelEndState = wheelEndStateRef.current

    if (!wheelEndState) {
      return
    }

    latestArgsRef.current.endTransform(
      wheelEndState.transform,
      createWheelMeta(wheelEndState.source, 'end')
    )
    wheelEndStateRef.current = null
    wheelEndTimerRef.current = null
  }, [])

  const scheduleWheelEnd = useCallback(
    (transform: VirtualPaperTransform, source: VirtualPaperInteractionMode) => {
      wheelEndStateRef.current = { transform, source }

      if (wheelEndTimerRef.current !== null) {
        window.clearTimeout(wheelEndTimerRef.current)
      }

      wheelEndTimerRef.current = window.setTimeout(
        finishWheelTransform,
        WHEEL_END_DEBOUNCE_MS
      )
    },
    [finishWheelTransform]
  )

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      const {
        wrapperRef,
        transform,
        enabledInteractions,
        minScale,
        maxScale,
        updateTransform,
        isScrollMode
      } = latestArgsRef.current
      const wrapper = wrapperRef.current
      const hasInteraction = (mode: VirtualPaperInteractionMode) => {
        return enabledInteractions.includes(mode)
      }

      // scroll 模式：非 ctrl/meta 的 wheel 交给原生滚动（overflow:auto 处理），
      // 不 preventDefault、不更新 transform；原生 scroll 事件会反向同步 transform。
      // 仅 ctrl/meta + wheel 触发 JS zoom（保持焦点锚点）。
      if (isScrollMode && !event.ctrlKey && !event.metaKey) {
        return
      }

      let nextTransform: VirtualPaperTransform | null = null
      let source: VirtualPaperInteractionMode | null = null

      if (event.ctrlKey || event.metaKey) {
        if (hasInteraction(VirtualPaperInteractionMode.MouseWheelCtrlZoom) && wrapper) {
          source = VirtualPaperInteractionMode.MouseWheelCtrlZoom
          nextTransform = getWheelZoomTransform(
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

      event.preventDefault()
      updateTransform(nextTransform, createWheelMeta(source, 'change'))
      scheduleWheelEnd(nextTransform, source)
    },
    [scheduleWheelEnd]
  )

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
    }
  }, [handleWheel])
}
