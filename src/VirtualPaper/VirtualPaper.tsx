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
  VirtualPaperRenderMode,
  DEFAULT_ENABLED_INTERACTIONS
} from './types'
import {
  getInitialTransform,
  serializeTransform,
  mergeDefaultTransform
} from './transform'
import { useMultiDragInteractions } from './useMultiDragInteractions'
import { useWheelInteractions } from './useWheelInteractions'
import { useScrollGeometry } from './useScrollGeometry'
import './VirtualPaper.css'

export const VirtualPaper = ({
  children,
  enabledInteractions = DEFAULT_ENABLED_INTERACTIONS,
  initialPlacement = VirtualPaperInitialPlacement.Center,
  renderMode = VirtualPaperRenderMode.Transform,
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
  // transform 模式：containerRef 指向应用 transform 的 container（同时是 user-visible 层）
  // scroll 模式：containerRef 直接指向文档流 container，原生 scroll 会让 rect.left/top 等于 transform.x/y
  const containerRef = useRef<HTMLDivElement>(null)
  const isControlled = controlledTransform !== undefined
  const isScrollMode = renderMode === VirtualPaperRenderMode.Scroll

  const [uncontrolledTransform, setUncontrolledTransform] = useState<VirtualPaperTransform>(() => {
    const base = { x: 0, y: 0, scale: 1 }
    return mergeDefaultTransform(base, defaultTransform, minScale, maxScale)
  })

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
    setUncontrolledTransform(merged)

    if (onTransformChange) {
      onTransformChange(merged, {
        source: 'initialPlacement',
        inputType: 'programmatic',
        phase: 'change'
      })
    }
  }, [])

  const transform = isControlled ? controlledTransform : uncontrolledTransform

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

  const transformStyle = useMemo(() => serializeTransform(transform), [transform])

  // scroll 模式：解析内容基础尺寸（contentSize prop 优先）
  const { baseSize: scrollBaseSize } = useScrollGeometry({
    enabled: isScrollMode,
    contentSize
  })

  // scroll 模式：transform 变化（zoom/drag/controlled prop）→ 原生滚动位置
  // 原生 scroll 只能表示 transform.x/y <= 0，正向 transform 会被钳制到 scroll 0。
  useLayoutEffect(() => {
    if (!isScrollMode) return
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const targetLeft = Math.max(0, Math.round(-transform.x))
    const targetTop = Math.max(0, Math.round(-transform.y))
    if (wrapper.scrollLeft !== targetLeft) {
      wrapper.scrollLeft = targetLeft
    }
    if (wrapper.scrollTop !== targetTop) {
      wrapper.scrollTop = targetTop
    }
  }, [isScrollMode, transform.x, transform.y])

  // scroll 模式：原生滚动位置 → transform state。
  // 写 scroll 后触发的 scroll 事件会因值相等 bail out，避免同步循环。
  useEffect(() => {
    if (!isScrollMode) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const handleScroll = () => {
      const newX = -wrapper.scrollLeft
      const newY = -wrapper.scrollTop
      if (transform.x === newX && transform.y === newY) return
      updateTransform(
        { ...transform, x: newX, y: newY },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    }

    wrapper.addEventListener('scroll', handleScroll, { passive: true })
    return () => wrapper.removeEventListener('scroll', handleScroll)
  }, [isScrollMode, transform, updateTransform])

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
    transform,
    enabledInteractions,
    minScale,
    maxScale,
    updateTransform,
    endTransform
  })

  useWheelInteractions({
    wrapperRef,
    containerRef,
    transform,
    enabledInteractions,
    minScale,
    maxScale,
    updateTransform,
    endTransform,
    isScrollMode
  })

  // --- 渲染分支 ---
  // Transform 模式（默认）：单层 container，CSS transform: translate3d + scale 驱动平移+缩放
  // Scroll 模式：2 层 wrapper(overflow:auto) > container(文档流宽高缩放)
  if (isScrollMode) {
    const scaledWidth = scrollBaseSize.width > 0
      ? scrollBaseSize.width * transform.scale
      : 'auto'
    const scaledHeight = scrollBaseSize.height > 0
      ? scrollBaseSize.height * transform.scale
      : 'auto'

    const scrollWrapperStyles: CSSProperties = {
      ...baseWrapperStyle,
      overflow: 'auto',
      touchAction: 'none',
      ...style,
      ...wrapperPropsStyle
    }
    // 注意：scroll 模式下 width/height 由 scale * contentSize 决定，是渲染模式的内在属性，
    // 不允许被用户的 containerStyle/containerPropsStyle 覆盖（否则缩放失效）。
    // 因此 scaled 尺寸必须放在 spread 之后，确保最高优先级。
    const scrollContainerStyles: CSSProperties = {
      position: 'relative',
      touchAction: 'none',
      userSelect: 'none',
      ...containerStyle,
      ...containerPropsStyle,
      width: scaledWidth,
      height: scaledHeight
    }
    return (
      <div
        {...restWrapperProps}
        ref={wrapperRef}
        data-testid={wrapperDataTestId}
        className={wrapperClassNames}
        style={scrollWrapperStyles}
      >
        <div
          {...restContainerProps}
          ref={containerRef}
          data-testid={containerDataTestId}
          className={containerClassNames}
          style={scrollContainerStyles}
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
