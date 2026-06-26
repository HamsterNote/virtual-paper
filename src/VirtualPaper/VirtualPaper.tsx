import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { CSSProperties } from 'react'
import type {
  VirtualPaperProps,
  VirtualPaperTransform,
  VirtualPaperTransformMeta
} from './types'
import {
  VirtualPaperInitialPlacement,
  VirtualPaperInteractionMode,
  VirtualPaperRenderMode,
  DEFAULT_ENABLED_INTERACTIONS,
  READER_MODE_NATIVE_TOUCH_ACTION
} from './types'
import {
  clampReaderTransform,
  computeReaderLayoutMetrics,
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

/**
 * 容差（px）：浏览器在 transform→scroll 回写时存在亚像素舍入，
 * 导致 scrollLeft/scrollTop 与程序化目标有微小偏差。
 * 若偏差在此范围内，scroll handler 视为程序化回写的回声（echo），
 * 跳过 transform 更新，防止无限更新循环。
 */
const READER_PROGRAMMATIC_SCROLL_TOLERANCE_PX = 1

/**
 * 校验 lazyWillChange 是否为可用正值。
 * 非数字、NaN、Infinity 以及 <= 0 均视为禁用。
 */
const isLazyWillChangeEnabled = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export const VirtualPaper = ({
  children,
  enabledInteractions = DEFAULT_ENABLED_INTERACTIONS,
  initialPlacement = VirtualPaperInitialPlacement.Center,
  renderMode,
  readerMode,
  containMode = false,
  edgeElasticScroll = false,
  readerModeZoomDebounceMs,
  lazyWillChange = 0,
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
  const programmaticReaderScrollRef = useRef<{
    left: number
    top: number
  } | null>(null)
  const isControlled = controlledTransform !== undefined
  // 兼容已废弃的 renderMode：显式 readerMode 优先。
  const isReaderMode =
    readerMode ?? renderMode === VirtualPaperRenderMode.Scroll
  const isContainMode = containMode === true && !isReaderMode
  const mouseDragEnabled = enabledInteractions.includes(
    VirtualPaperInteractionMode.MouseDragPan
  )
  const contentWidth = contentSize?.width
  const contentHeight = contentSize?.height

  const [uncontrolledTransform, setUncontrolledTransform] =
    useState<VirtualPaperTransform>(() => {
      const base = { x: 0, y: 0, scale: 1 }
      return mergeDefaultTransform(base, defaultTransform, minScale, maxScale)
    })
  const [containRevision, setContainRevision] = useState(0)
  const [readerWrapperSize, setReaderWrapperSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [elasticActiveCount, setElasticActiveCount] = useState(0)
  const elasticActive = elasticActiveCount > 0

  const [isWillChangeActive, setIsWillChangeActive] = useState(false)
  const lazyWillChangeRef = useRef(lazyWillChange)
  const willChangeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null
  )

  lazyWillChangeRef.current = lazyWillChange

  const clearWillChangeTimer = useCallback(() => {
    if (willChangeTimerRef.current !== null) {
      window.clearTimeout(willChangeTimerRef.current)
      willChangeTimerRef.current = null
    }
  }, [])

  const incrementElasticActive = useCallback(() => {
    setElasticActiveCount((count) => count + 1)
  }, [])
  const decrementElasticActive = useCallback(() => {
    setElasticActiveCount((count) => Math.max(0, count - 1))
  }, [])

  const projectForContain = useCallback(
    (next: VirtualPaperTransform): VirtualPaperTransform => {
      if (!isContainMode) return next

      const wrapper = wrapperRef.current
      const container = containerRef.current
      if (!wrapper || !container) return next

      return projectContainTransformForElements(next, wrapper, container)
    },
    [isContainMode]
  )

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

    const merged = mergeDefaultTransform(
      initial,
      defaultTransform,
      minScale,
      maxScale
    )
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
    const renderElasticTransform =
      isContainMode && edgeElasticScroll && elasticActive
    if (renderElasticTransform) return transform
    return isContainMode ? projectForContain(transform) : transform
  }, [
    containRevision,
    edgeElasticScroll,
    isContainMode,
    projectForContain,
    transform,
    elasticActive
  ])

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

  const updateTransform = useCallback(
    (next: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      if (!isControlled) {
        setUncontrolledTransform(next)
      }
      if (onTransformChange) {
        onTransformChange(next, meta)
      }
      if (isLazyWillChangeEnabled(lazyWillChangeRef.current)) {
        clearWillChangeTimer()
        setIsWillChangeActive(true)
      }
    },
    [isControlled, onTransformChange, clearWillChangeTimer]
  )

  const endTransform = useCallback(
    (next: VirtualPaperTransform, meta: VirtualPaperTransformMeta) => {
      if (!isControlled) {
        setUncontrolledTransform(next)
      }
      if (onTransformChangeEnd) {
        onTransformChangeEnd(next, meta)
      }
      const ms = lazyWillChangeRef.current
      if (isLazyWillChangeEnabled(ms)) {
        clearWillChangeTimer()
        willChangeTimerRef.current = window.setTimeout(() => {
          willChangeTimerRef.current = null
          setIsWillChangeActive(false)
        }, ms)
      }
    },
    [isControlled, onTransformChangeEnd, clearWillChangeTimer]
  )

  const transformStyle = useMemo(
    () => serializeTransform(displayTransform),
    [displayTransform]
  )

  const getReaderContentSize = useCallback(() => {
    const wrapper = wrapperRef.current

    if (contentWidth !== undefined && contentHeight !== undefined) {
      return { width: contentWidth, height: contentHeight }
    }

    if (isReaderMode && !warnedMissingContentSizeRef.current) {
      warnedMissingContentSizeRef.current = true
      console.warn(
        'VirtualPaper: readerMode requires contentSize to compute native scroll geometry. ' +
          'Falling back to wrapper dimensions; scaling and scrolling may not behave as expected.'
      )
    }

    return {
      width: wrapper?.clientWidth ?? 0,
      height: wrapper?.clientHeight ?? 0
    }
  }, [contentHeight, contentWidth, isReaderMode])

  useLayoutEffect(() => {
    if (!isReaderMode) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const nextWidth = wrapper.clientWidth
    const nextHeight = wrapper.clientHeight
    setReaderWrapperSize((prev) => {
      if (prev && prev.width === nextWidth && prev.height === nextHeight)
        return prev
      return { width: nextWidth, height: nextHeight }
    })
  }, [isReaderMode])

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
    const shouldUpdateScroll =
      wrapper.scrollLeft !== targetLeft || wrapper.scrollTop !== targetTop

    if (shouldUpdateScroll) {
      // 标记本次滚动来自 transform -> native scroll 的同步，避免 scroll 事件再回写 transform。
      programmaticReaderScrollRef.current = { left: targetLeft, top: targetTop }
    }
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
  useLayoutEffect(() => {
    transformRef.current = transform
  }, [transform])

  useEffect(() => {
    if (!isReaderMode) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const handleScroll = () => {
      const programmaticScroll = programmaticReaderScrollRef.current
      if (programmaticScroll) {
        programmaticReaderScrollRef.current = null
        if (
          Math.abs(wrapper.scrollLeft - programmaticScroll.left) <=
            READER_PROGRAMMATIC_SCROLL_TOLERANCE_PX &&
          Math.abs(wrapper.scrollTop - programmaticScroll.top) <=
            READER_PROGRAMMATIC_SCROLL_TOLERANCE_PX
        )
          return
      }

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
      )
        return
      updateTransform(nextTransform, {
        source: VirtualPaperInteractionMode.TrackpadScrollPan,
        inputType: 'wheel',
        phase: 'change'
      })
    }

    wrapper.addEventListener('scroll', handleScroll, { passive: true })
    return () => wrapper.removeEventListener('scroll', handleScroll)
  }, [getReaderContentSize, isReaderMode, updateTransform])

  useEffect(() => {
    return () => clearWillChangeTimer()
  }, [clearWillChangeTimer])

  useEffect(() => {
    if (isLazyWillChangeEnabled(lazyWillChange)) return
    clearWillChangeTimer()
    setIsWillChangeActive(false)
  }, [lazyWillChange, clearWillChangeTimer])

  const baseWrapperStyle = {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%'
  } as const

  const baseContainerStyle = {
    position: 'absolute',
    transformOrigin: '0 0',
    touchAction: 'none'
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

  const wrapperDataTestId =
    ((wrapperProps as Record<string, unknown> | undefined)?.['data-testid'] as
      | string
      | undefined) ?? 'virtual-paper-wrapper'
  const containerDataTestId =
    ((containerProps as Record<string, unknown> | undefined)?.[
      'data-testid'
    ] as string | undefined) ?? 'virtual-paper-container'

  const wrapperClassNames = [
    'virtual-paper-wrapper',
    className,
    wrapperPropsClassName
  ]
    .filter(Boolean)
    .join(' ')

  const containerClassNames = [
    'virtual-paper-container',
    containerClassName,
    containerPropsClassName
  ]
    .filter(Boolean)
    .join(' ')

  const wrapperStyles = {
    ...baseWrapperStyle,
    ...style,
    ...wrapperPropsStyle
  }

  const containerUserSelect = (mouseDragEnabled ? 'none' : 'text') as
    | 'none'
    | 'text'

  const containerStyles = {
    ...baseContainerStyle,
    userSelect: containerUserSelect,
    WebkitUserSelect: containerUserSelect,
    ...containerStyle,
    ...containerPropsStyle,
    ...(isWillChangeActive ? { willChange: 'transform' } : {}),
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
    edgeElasticScroll,
    incrementElasticActive,
    decrementElasticActive,
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
    edgeElasticScroll,
    incrementElasticActive,
    decrementElasticActive,
    readerModeZoomDebounceMs
  })

  if (isReaderMode) {
    const wrapper = wrapperRef.current
    const measuredWidth = readerWrapperSize?.width ?? wrapper?.clientWidth ?? 0
    const measuredHeight =
      readerWrapperSize?.height ?? wrapper?.clientHeight ?? 0
    const readerContentSize = getReaderContentSize()
    const readerMetrics = computeReaderLayoutMetrics(
      readerContentSize,
      transform.scale,
      measuredWidth,
      measuredHeight,
      transform
    )

    const readerWrapperStyles: CSSProperties = {
      ...baseWrapperStyle,
      overflow: 'auto',
      ...style,
      ...wrapperPropsStyle
    }
    const readerContainerStyles: CSSProperties = {
      position: 'relative',
      touchAction: READER_MODE_NATIVE_TOUCH_ACTION,
      userSelect: 'none',
      ...containerStyle,
      ...containerPropsStyle,
      width: readerMetrics.width,
      height: readerMetrics.height,
      marginLeft: readerMetrics.offsetX,
      marginTop: readerMetrics.offsetY
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
