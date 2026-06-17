import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  VirtualPaperProps,
  VirtualPaperTransform,
  VirtualPaperTransformMeta
} from './types'
import {
  VirtualPaperInitialPlacement,
  DEFAULT_ENABLED_INTERACTIONS
} from './types'
import {
  getInitialTransform,
  serializeTransform,
  mergeDefaultTransform
} from './transform'
import { useMultiDragInteractions } from './useMultiDragInteractions'
import { useWheelInteractions } from './useWheelInteractions'
import './VirtualPaper.css'

export const VirtualPaper = ({
  children,
  enabledInteractions = DEFAULT_ENABLED_INTERACTIONS,
  initialPlacement = VirtualPaperInitialPlacement.Center,
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
  const isControlled = controlledTransform !== undefined

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
