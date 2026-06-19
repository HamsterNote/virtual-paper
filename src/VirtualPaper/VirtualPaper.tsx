import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  VirtualPaperProps,
  VirtualPaperTransform,
  VirtualPaperTransformMeta
} from './types'
import {
  VirtualPaperInitialPlacement,
  VirtualPaperInteractionMode,
  DEFAULT_ENABLED_INTERACTIONS
} from './types'
import {
  clampReaderTransform,
  convertLayoutToTransform,
  convertTransformToLayout,
  getInitialTransform,
  serializeTransform,
  mergeDefaultTransform
} from './transform'
import { projectContainTransformForElements } from './containMode'
import { useMultiDragInteractions } from './useMultiDragInteractions'
import { useWheelInteractions } from './useWheelInteractions'
import './VirtualPaper.css'

export const VirtualPaper = ({
  children,
  enabledInteractions = DEFAULT_ENABLED_INTERACTIONS,
  initialPlacement = VirtualPaperInitialPlacement.Center,
  readerMode = false,
  containMode = false,
  readerModeZoomDebounceMs,
  contentSize,
  transform: controlledTransform,
  defaultTransform,
  minScale = 0.25,
  maxScale = 4,
  onTransformChange,
  onTransformChangeEnd,
  className,
  style,
  containerClassName,
  containerStyle,
  wrapperProps,
  containerProps
}: VirtualPaperProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const warnedMissingContentSizeRef = useRef(false)
  const isControlled = controlledTransform !== undefined
  const isReaderMode = readerMode === true
  const isContainMode = containMode === true && !isReaderMode

  const [uncontrolledTransform, setUncontrolledTransform] = useState<VirtualPaperTransform>(() => {
    const base = { x: 0, y: 0, scale: 1 }
    return mergeDefaultTransform(base, defaultTransform, minScale, maxScale)
  })
  const [containRevision, setContainRevision] = useState(0)

  const projectForContain = useCallback((next: VirtualPaperTransform): VirtualPaperTransform => {
    if (!isContainMode) return next

    const wrapper = wrapperRef.current
    const container = containerRef.current
    if (!wrapper || !container) return next

    return projectContainTransformForElements(next, wrapper, container)
  }, [isContainMode])

  useLayoutEffect(() => {
    if (isControlled) return

    const wrapper = wrapperRef.current
    const container = containerRef.current
    if (!wrapper || !container) return

    const wrapperRect = wrapper.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    const initial = getInitialTransform({
      placement: initialPlacement,
      wrapperWidth: wrapperRect.width,
      wrapperHeight: wrapperRect.height,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height
    })

    const merged = mergeDefaultTransform(initial, defaultTransform, minScale, maxScale)
    const projected = projectForContain(merged)
    setUncontrolledTransform(projected)

    if (onTransformChange) {
      onTransformChange(projected, {
        source: 'initialPlacement',
        inputType: 'programmatic',
        phase: 'change'
      })
    }
  }, [])

  const transform = isControlled ? controlledTransform : uncontrolledTransform
  const displayTransform = useMemo(() => {
    void containRevision
    return isContainMode ? projectForContain(transform) : transform
  }, [containRevision, isContainMode, projectForContain, transform])

  useLayoutEffect(() => {
    if (!isContainMode || isReaderMode) return

    const wrapper = wrapperRef.current
    const container = containerRef.current
    if (!wrapper || !container) return

    const bumpContainRevision = () => {
      setContainRevision((revision) => revision + 1)
    }

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(bumpContainRevision)
      observer.observe(wrapper)
      observer.observe(container)
      bumpContainRevision()
      return () => observer.disconnect()
    }

    bumpContainRevision()
    window.addEventListener('resize', bumpContainRevision)
    return () => window.removeEventListener('resize', bumpContainRevision)
  }, [isContainMode, isReaderMode])

  const updateTransform = useCallback((
    next: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => {
    if (!isControlled) {
      setUncontrolledTransform(next)
    }
    if (onTransformChange) {
      onTransformChange(next, meta)
    }
  }, [isControlled, onTransformChange])

  const endTransform = useCallback((
    next: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => {
    if (!isControlled) {
      setUncontrolledTransform(next)
    }
    if (onTransformChangeEnd) {
      onTransformChangeEnd(next, meta)
    }
  }, [isControlled, onTransformChangeEnd])

  const transformStyle = useMemo(() => serializeTransform(displayTransform), [displayTransform])

  const getReaderContentSize = useCallback(() => {
    const wrapper = wrapperRef.current

    if (contentSize) return contentSize

    if (isReaderMode && !warnedMissingContentSizeRef.current) {
      warnedMissingContentSizeRef.current = true
    }

    return {
      width: wrapper?.clientWidth ?? 0,
      height: wrapper?.clientHeight ?? 0
    }
  }, [contentSize, isReaderMode])

  useLayoutEffect(() => {
    if (!isReaderMode) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const wrapperWidth = wrapper.clientWidth
    const wrapperHeight = wrapper.clientHeight

    const readerLayout = convertTransformToLayout(
      transform,
      getReaderContentSize(),
      wrapperWidth,
      wrapperHeight
    )
    const targetLeft = Math.max(0, Math.round(readerLayout.scrollLeft))
    const targetTop = Math.max(0, Math.round(readerLayout.scrollTop))
    if (wrapper.scrollLeft !== targetLeft) {
      wrapper.scrollLeft = targetLeft
    }
    if (wrapper.scrollTop !== targetTop) {
      wrapper.scrollTop = targetTop
    }
  }, [getReaderContentSize, isReaderMode, transform])

  // 用 ref 持有最新 transform，避免 scroll handler 闭包过期。
  // 场景：滚动期间触发 ctrl+wheel 缩放时，闭包里的 transform.scale 会过期，
  // 后续 scroll 事件会用 stale scale 覆盖最新值，导致缩放被回退。
  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  }, [transform])

  useEffect(() => {
    if (!isReaderMode) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const handleScroll = () => {
      const currentTransform = transformRef.current
      const readerContentSize = getReaderContentSize()
      const layoutTransform = convertLayoutToTransform(
        readerContentSize.width * currentTransform.scale,
        readerContentSize.height * currentTransform.scale,
        wrapper.scrollLeft,
        wrapper.scrollTop,
        currentTransform.scale
      )
      const nextTransform = clampReaderTransform(
        layoutTransform,
        readerContentSize,
        wrapper.clientWidth,
        wrapper.clientHeight
      )
      if (
        currentTransform.x === nextTransform.x &&
        currentTransform.y === nextTransform.y &&
        currentTransform.scale === nextTransform.scale
      ) return
      updateTransform(
        nextTransform,
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    }

    wrapper.addEventListener('scroll', handleScroll, { passive: true })
    return () => wrapper.removeEventListener('scroll', handleScroll)
  }, [getReaderContentSize, isReaderMode, updateTransform])

  const baseWrapperStyle = {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%'
  } as const

  const baseContainerStyle = {
    position: 'absolute',
    transformOrigin: '0 0',
    willChange: 'transform',
    touchAction: 'none',
    userSelect: 'none'
  } as const

  const {
    className: wrapperPropsClassName,
    style: wrapperPropsStyle,
    ...restWrapperProps
  } = wrapperProps ?? {}

  const {
    className: containerPropsClassName,
    style: containerPropsStyle,
    ...restContainerProps
  } = containerProps ?? {}

  const wrapperDataTestId = ((wrapperProps as Record<string, unknown> | undefined)?.['data-testid'] as string | undefined) ?? 'virtual-paper-wrapper'
  const containerDataTestId = ((containerProps as Record<string, unknown> | undefined)?.['data-testid'] as string | undefined) ?? 'virtual-paper-container'

  const wrapperClassNames = [
    'virtual-paper-wrapper',
    className,
    wrapperPropsClassName
  ].filter(Boolean).join(' ')

  const containerClassNames = [
    'virtual-paper-container',
    containerClassName,
    containerPropsClassName
  ].filter(Boolean).join(' ')

  const wrapperStyles = {
    ...baseWrapperStyle,
    ...style,
    ...wrapperPropsStyle
  }

  const containerStyles = {
    ...baseContainerStyle,
    ...containerStyle,
    ...containerPropsStyle,
    transform: transformStyle,
    transformOrigin: '0 0'
  }

  useMultiDragInteractions({
    wrapperRef,
    containerRef,
    transform: displayTransform,
    enabledInteractions,
    minScale,
    maxScale,
    contentSize,
    updateTransform,
    endTransform,
    isReaderMode,
    containMode: isContainMode,
    readerModeZoomDebounceMs
  })

  useWheelInteractions({
    wrapperRef,
    containerRef,
    transform: displayTransform,
    enabledInteractions,
    minScale,
    maxScale,
    contentSize,
    updateTransform,
    endTransform,
    isReaderMode,
    containMode: isContainMode,
    readerModeZoomDebounceMs
  })

  if (isReaderMode) {
    const wrapper = wrapperRef.current
    const readerContentSize = getReaderContentSize()
    const readerLayout = convertTransformToLayout(
      transform,
      readerContentSize,
      wrapper?.clientWidth ?? readerContentSize.width,
      wrapper?.clientHeight ?? readerContentSize.height
    )

    const readerWrapperStyles: CSSProperties = {
      ...baseWrapperStyle,
      overflow: 'auto',
      ...style,
      ...wrapperPropsStyle
    }
    const readerContainerStyles: CSSProperties = {
      position: 'relative',
      touchAction: 'none',
      userSelect: 'none',
      ...containerStyle,
      ...containerPropsStyle,
      width: readerLayout.width,
      height: readerLayout.height
    }
    return (
      <div
        {...restWrapperProps}
        ref={wrapperRef}
        data-testid={wrapperDataTestId}
        className={wrapperClassNames}
        style={readerWrapperStyles}
      >
        <div
          {...restContainerProps}
          ref={containerRef}
          data-testid={containerDataTestId}
          className={containerClassNames}
          style={readerContainerStyles}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      {...restWrapperProps}
      ref={wrapperRef}
      data-testid={wrapperDataTestId}
      className={wrapperClassNames}
      style={wrapperStyles}
    >
      <div
        {...restContainerProps}
        ref={containerRef}
        data-testid={containerDataTestId}
        className={containerClassNames}
        style={containerStyles}
      >
        {children}
      </div>
    </div>
  )
}
