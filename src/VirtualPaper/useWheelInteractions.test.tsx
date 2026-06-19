import '@testing-library/jest-dom/vitest'
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
  isReaderMode?: boolean
  containMode?: boolean
  readerModeZoomDebounceMs?: number
  onUpdate?: VirtualPaperTransformUpdater
  onEnd?: VirtualPaperTransformUpdater
}

const defaultTransform = { x: 10, y: 20, scale: 1 }

function WheelHarness({
  enabledInteractions,
  initialTransform = defaultTransform,
  minScale = 0.25,
  maxScale = 4,
  isReaderMode = false,
  containMode = false,
  readerModeZoomDebounceMs,
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
    endTransform: onEnd,
    isReaderMode,
    containMode,
    readerModeZoomDebounceMs
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

const mockMeasurements = (
  wrapper: HTMLElement,
  container: HTMLElement,
  wrapperSize: { width: number; height: number },
  containerSize: { width: number; height: number }
) => {
  Object.defineProperty(wrapper, 'clientWidth', { value: wrapperSize.width, configurable: true })
  Object.defineProperty(wrapper, 'clientHeight', { value: wrapperSize.height, configurable: true })
  Object.defineProperty(container, 'offsetWidth', { value: containerSize.width, configurable: true })
  Object.defineProperty(container, 'offsetHeight', { value: containerSize.height, configurable: true })
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
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
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
      source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
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

  // --- readerMode wheel 行为 ---

  it('readerMode: non-ctrl wheel does not preventDefault or update transform (native scroll)', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        isReaderMode
        onUpdate={onUpdate}
      />
    )

    const { preventDefault } = dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaX: 40,
      deltaY: 25,
      ctrlKey: false
    })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('readerMode: ctrl+wheel still zooms with preventDefault', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        isReaderMode
        onUpdate={onUpdate}
      />
    )

    const { preventDefault } = dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -100,
      ctrlKey: true
    })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    expect(next.scale).toBeGreaterThan(1)
  })

  it('readerMode: MouseWheelZoom (plain wheel) does not zoom (native scroll takes over)', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelZoom]}
        isReaderMode
        onUpdate={onUpdate}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -100,
      ctrlKey: false
    })

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('readerMode: wheel end debounce defaults to 500ms when readerModeZoomDebounceMs is not set', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        isReaderMode
        onEnd={onEnd}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -100,
      ctrlKey: true
    })

    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(onEnd).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('readerMode: wheel end debounce respects custom readerModeZoomDebounceMs=300', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        isReaderMode
        readerModeZoomDebounceMs={300}
        onEnd={onEnd}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -100,
      ctrlKey: true
    })

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(onEnd).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('readerMode: readerModeZoomDebounceMs=0 triggers endTransform immediately on next tick', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        isReaderMode
        readerModeZoomDebounceMs={0}
        onEnd={onEnd}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -100,
      ctrlKey: true
    })

    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('readerMode: ctrl+wheel zoom is clamped to maxScale', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 3.9 }}
        maxScale={4}
        isReaderMode
        onUpdate={onUpdate}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: -1000,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    expect(next.scale).toBe(4)
  })

  it('readerMode: ctrl+wheel zoom is clamped to minScale', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 0.26 }}
        minScale={0.25}
        isReaderMode
        onUpdate={onUpdate}
      />
    )

    dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaY: 1000,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    expect(next.scale).toBe(0.25)
  })

  // --- containMode projection ---

  it('containMode: wheel pan on oversized content clamps at left/top and right/bottom bounds', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        onUpdate={onUpdate}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -900, deltaY: -700, ctrlKey: false })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: 0, y: 0, scale: 1 },
      expect.objectContaining({ source: VirtualPaperInteractionMode.TrackpadScrollPan })
    )

    onUpdate.mockClear()

    dispatchWheel(wrapper, { deltaX: 900, deltaY: 700, ctrlKey: false })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: -800, y: -600, scale: 1 },
      expect.objectContaining({ source: VirtualPaperInteractionMode.TrackpadScrollPan })
    )
  })

  it('containMode: ctrl-wheel zoom on fitted content centers fitted axes', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        onUpdate={onUpdate}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 400, height: 300 })

    dispatchWheel(wrapper, { deltaY: -100, ctrlKey: true })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const expectedScale = Math.exp(100 * 0.002)
    const scaledWidth = 400 * expectedScale
    const scaledHeight = 300 * expectedScale

    expect(next.scale).toBeCloseTo(expectedScale)
    expect(next.x).toBeCloseTo((800 - scaledWidth) / 2)
    expect(next.y).toBeCloseTo((600 - scaledHeight) / 2)
  })

  it('containMode: mixed-axis ctrl-wheel zoom centers fitted axis and clamps oversized axis', () => {
    const onUpdate = vi.fn()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        onUpdate={onUpdate}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 300 })

    dispatchWheel(wrapper, { deltaY: -100, ctrlKey: true })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const expectedScale = Math.exp(100 * 0.002)
    const scaledWidth = 1600 * expectedScale
    const scaledHeight = 300 * expectedScale

    expect(next.scale).toBeCloseTo(expectedScale)
    expect(next.x).toBeGreaterThanOrEqual(800 - scaledWidth)
    expect(next.x).toBeLessThanOrEqual(0)
    expect(next.y).toBeCloseTo((600 - scaledHeight) / 2)
  })
})
