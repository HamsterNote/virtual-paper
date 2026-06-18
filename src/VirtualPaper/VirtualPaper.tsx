import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  VirtualPaperProps,
  VirtualPaperTransform,
  VirtualPaperTransformMeta
} from './types'
import {
  VirtualPaperInitialPlacement,
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
  // scroll 模式：containerRef 指向 scaledBox —— 与 transform 模式语义对应（都代表 transform 应用后的
  //   内容盒子），供 initial placement 通过 getBoundingClientRect 测量内容尺寸算居中；
  //   交互 hooks（wheel/multi-drag）以 wrapperRect + transform state 计算锚点，仅需 ref 非空
  const containerRef = useRef<HTMLDivElement>(null)
  // scroll 模式专用：指向 scaler 元素，用于测量未缩放内容尺寸（offsetWidth/Height）
  const measureRef = useRef<HTMLDivElement>(null)
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

  // scroll 模式几何：测量 wrapper 视口 + scaler 基础尺寸，计算 scrollSurface/scaledBox/scroll 同步参数
  // base size 优先级：contentSize prop > measureRef.offsetWidth/Height > {0,0}
  const { geometry: scrollGeometry, baseSize: scrollBaseSize } = useScrollGeometry({
    enabled: isScrollMode,
    wrapperRef,
    measureRef,
    contentSize,
    transform
  })

  // scroll 同步：程序化写 wrapper.scrollLeft/Top = origin - transform
  // overflow:hidden 下程序化 scroll 仍生效，且避免原生滚动条/手势冲突
  useLayoutEffect(() => {
    if (!isScrollMode) return
    const wrapper = wrapperRef.current
    if (!wrapper || !scrollGeometry.ready) return
    wrapper.scrollLeft = scrollGeometry.scrollLeft
    wrapper.scrollTop = scrollGeometry.scrollTop
  }, [
    isScrollMode,
    scrollGeometry.ready,
    scrollGeometry.scrollLeft,
    scrollGeometry.scrollTop
  ])

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
    endTransform
  })

  // --- 渲染分支 ---
  // Transform 模式（默认）：单层 container，CSS transform: translate3d + scale 驱动平移+缩放
  // Scroll 模式：4 层 wrapper > scrollSurface > scaledBox[containerRef] > scaler[measureRef]
  //   - scrollSurface: position:absolute, width/height = surface 几何（撑开滚动区供程序化 scroll；
  //     absolute 而非 relative，避免无 specified height 的父级下撑开 wrapper.clientHeight）
  //   - scaledBox: position:absolute, left/top=origin, width/height=scaled（containerRef 指向此层，
  //     与 transform 模式 container 语义对应，供 initial placement 测量内容尺寸）
  //   - scaler: transform:scale(s), width/height=base（measureRef 指向此层测 offset；
  //     user-visible 的 containerStyle/ClassName/testid 应用到此层）
  if (isScrollMode) {
    const scaledWidth = scrollBaseSize.width * transform.scale
    const scaledHeight = scrollBaseSize.height * transform.scale
    // position:absolute 让 scrollSurface 脱离文档流不撑开 wrapper.clientHeight
    // （wrapper.height:100% 在父无 specified height 时会退化 auto，relative 子元素会撑开它）
    // absolute 子元素仍参与 wrapper 的 scrollable overflow（overflow:hidden），几何不变
    const scrollSurfaceStyles: CSSProperties = {
      position: 'absolute',
      top: 0,
      left: 0,
      width: scrollGeometry.surfaceWidth,
      height: scrollGeometry.surfaceHeight
    }
    const scrollBoxStyles: CSSProperties = {
      position: 'absolute',
      left: scrollGeometry.originX,
      top: scrollGeometry.originY,
      width: scaledWidth,
      height: scaledHeight
    }
    const scrollScalerStyles: CSSProperties = {
      position: 'relative',
      transformOrigin: '0 0',
      willChange: 'transform',
      touchAction: 'none',
      userSelect: 'none',
      ...containerStyle,
      ...containerPropsStyle,
      transform: `scale(${transform.scale})`,
      // 未测量且无 contentSize 时用 auto 让 children 撑开，避免 0 宽度导致测量死循环
      width: scrollBaseSize.width > 0 ? scrollBaseSize.width : 'auto',
      height: scrollBaseSize.height > 0 ? scrollBaseSize.height : 'auto'
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
          data-testid="virtual-paper-scroll-surface"
          className="virtual-paper-scroll-surface"
          style={scrollSurfaceStyles}
        >
          <div
            ref={containerRef}
            data-testid="virtual-paper-scroll-box"
            className="virtual-paper-scroll-box"
            style={scrollBoxStyles}
          >
            <div
              {...restContainerProps}
              ref={measureRef}
              data-testid={containerDataTestId}
              className={containerClassNames}
              style={scrollScalerStyles}
            >
              {children}
            </div>
          </div>
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
