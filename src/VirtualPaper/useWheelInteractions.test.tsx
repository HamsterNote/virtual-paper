import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'

import { useWheelInteractions } from './useWheelInteractions'
import {
  type VirtualPaperTransform,
  type VirtualPaperTransformUpdater,
  VirtualPaperInteractionMode
} from './types'

type WheelHarnessProps = {
  enabledInteractions: VirtualPaperInteractionMode[]
  initialTransform?: VirtualPaperTransform
  minScale?: number
  maxScale?: number
  onUpdate?: VirtualPaperTransformUpdater
  onEnd?: VirtualPaperTransformUpdater
}

const defaultTransform = { x: 10, y: 20, scale: 1 }

function WheelHarness({
  enabledInteractions,
  initialTransform = defaultTransform,
  minScale = 0.25,
  maxScale = 4,
  onUpdate = () => undefined,
  onEnd = () => undefined
}: WheelHarnessProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [transform, setTransform] = useState(initialTransform)

  useWheelInteractions({
    wrapperRef,
    containerRef,
    transform,
    enabledInteractions,
    minScale,
    maxScale,
    updateTransform(next, meta) {
      onUpdate(next, meta)
      setTransform(next)
    },
    endTransform: onEnd
  })

  return (
    <div ref={wrapperRef} data-testid="wheel-wrapper">
      <div
        ref={containerRef}
        data-testid="wheel-container"
        data-x={transform.x}
        data-y={transform.y}
        data-scale={transform.scale}
      />
    </div>
  )
}

const createRect = (left: number, top: number): DOMRect => ({
  width: 800,
  height: 600,
  top,
  left,
  right: left + 800,
  bottom: top + 600,
  x: left,
  y: top,
  toJSON() {
    return this
  }
}) as unknown as DOMRect

const dispatchWheel = (wrapper: HTMLElement, options: WheelEventInit) => {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: 110,
    clientY: 70,
    ...options
  })
  const preventDefault = vi.fn()

  Object.defineProperty(event, 'preventDefault', {
    value: preventDefault
  })

  act(() => {
    wrapper.dispatchEvent(event)
  })

  return { event, preventDefault }
}

describe('useWheelInteractions', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('data-testid') === 'wheel-wrapper') {
        return createRect(10, 20)
      }

      return originalGetBoundingClientRect.call(this)
    }
  })

  afterEach(() => {
    cleanup()
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('attaches a non-passive wheel listener to the wrapper element', () => {
    const addEventListener = vi.spyOn(HTMLDivElement.prototype, 'addEventListener')

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
      />
    )

    const hasNonPassiveWheelListener = addEventListener.mock.calls.some(
      ([type, , options]) => {
        if (type !== 'wheel' || typeof options !== 'object' || options === null) {
          return false
        }

        return (options as AddEventListenerOptions).passive === false
      }
    )

    expect(hasNonPassiveWheelListener).toBe(true)
  })

  it('pans with wheel deltas when TrackpadScrollPan is enabled', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        onUpdate={onUpdate}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaX: 40,
      deltaY: 25,
      ctrlKey: false
    })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: -30, y: -5, scale: 1 },
      {
        source: VirtualPaperInteractionMode.TrackpadScrollPan,
        inputType: 'wheel',
        phase: 'change'
      }
    )
    expect(screen.getByTestId('wheel-container')).toHaveAttribute('data-scale', '1')
  })

  it('does not consume wheel pan when TrackpadScrollPan is disabled', () => {
    const onUpdate = vi.fn()

    render(<WheelHarness enabledInteractions={[]} onUpdate={onUpdate} />)

    const { preventDefault } = dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaX: 40,
      deltaY: 25,
      ctrlKey: false
    })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(screen.getByTestId('wheel-container')).toHaveAttribute('data-x', '10')
    expect(screen.getByTestId('wheel-container')).toHaveAttribute('data-y', '20')
  })

  it('zooms in with ctrl wheel and keeps the cursor anchor stable', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadPinchZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        onUpdate={onUpdate}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -100,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const localX = 100
    const localY = 50
    const contentX = (localX - 0) / 1
    const contentY = (localY - 0) / 1

    expect(next.scale).toBeGreaterThan(1)
    expect(next.x + contentX * next.scale).toBeCloseTo(localX)
    expect(next.y + contentY * next.scale).toBeCloseTo(localY)
    expect(onUpdate.mock.calls[0][1]).toEqual({
      source: VirtualPaperInteractionMode.TrackpadPinchZoom,
      inputType: 'wheel',
      phase: 'change'
    })
  })

  it('zooms with plain wheel when MouseWheelZoom is enabled and pan is disabled', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelZoom]}
        onUpdate={onUpdate}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -100,
      ctrlKey: false
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform

    expect(next.scale).toBeGreaterThan(1)
    expect(onUpdate.mock.calls[0][1]).toEqual({
      source: VirtualPaperInteractionMode.MouseWheelZoom,
      inputType: 'wheel',
      phase: 'change'
    })
  })

  it('clamps wheel zoom to maxScale', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelZoom]}
        initialTransform={{ x: 0, y: 0, scale: 3.9 }}
        maxScale={4}
        onUpdate={onUpdate}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -1000
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform

    expect(next.scale).toBe(4)
  })

  it('calls preventDefault when the wheel event is consumed', () => {
    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
      />
    )

    const { preventDefault } = dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaX: 40,
      deltaY: 25
    })

    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('calls endTransform after the wheel end debounce', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        onEnd={onEnd}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaX: 40,
      deltaY: 25
    })

    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(onEnd).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(onEnd).toHaveBeenCalledWith(
      { x: -30, y: -5, scale: 1 },
      {
        source: VirtualPaperInteractionMode.TrackpadScrollPan,
        inputType: 'wheel',
        phase: 'end'
      }
    )
  })
})
