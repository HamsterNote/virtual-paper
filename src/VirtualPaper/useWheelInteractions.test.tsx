import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import type { MutableRefObject } from 'react'

// allow: SIZE_OK — Existing comprehensive hook behavior matrix was already oversized;
// splitting the suite is a separate behavior-preserving refactor outside this Todo.

import { useWheelInteractions } from './useWheelInteractions'
import { computeReaderLayoutMetrics } from './transform'
import {
  type VirtualPaperContentSize,
  type VirtualPaperTransform,
  type VirtualPaperTransformUpdater,
  VirtualPaperInteractionMode
} from './types'

type WheelHarnessProps = {
  enabledInteractions: VirtualPaperInteractionMode[]
  initialTransform?: VirtualPaperTransform
  minScale?: number
  maxScale?: number
  contentSize?: VirtualPaperContentSize
  isReaderMode?: boolean
  containMode?: boolean
  edgeElasticScroll?: boolean
  elasticActiveRef?: MutableRefObject<boolean>
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
  contentSize,
  isReaderMode = false,
  containMode = false,
  edgeElasticScroll = false,
  elasticActiveRef,
  readerModeZoomDebounceMs,
  onUpdate = () => undefined,
  onEnd = () => undefined
}: WheelHarnessProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const localElasticActiveRef = useRef(false)
  const [transform, setTransform] = useState(initialTransform)

  useWheelInteractions({
    wrapperRef,
    containerRef,
    transform,
    enabledInteractions,
    minScale,
    maxScale,
    contentSize,
    updateTransform(next, meta) {
      onUpdate(next, meta)
      setTransform(next)
    },
    endTransform: onEnd,
    isReaderMode,
    containMode,
    edgeElasticScroll,
    elasticActiveRef: elasticActiveRef ?? localElasticActiveRef,
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

const wrapperSize = { width: 800, height: 600 }
const wrapperCenter = { x: 400, y: 300 }

type ReaderPoint = {
  readonly x: number
  readonly y: number
}

type ReaderZoomSetup = {
  readonly contentSize: VirtualPaperContentSize
  readonly initialTransform: VirtualPaperTransform
  readonly onUpdate: VirtualPaperTransformUpdater
}

const getReaderContentPoint = (
  transform: VirtualPaperTransform,
  contentSize: VirtualPaperContentSize,
  localPoint: ReaderPoint
): ReaderPoint => {
  const metrics = computeReaderLayoutMetrics(
    contentSize,
    transform.scale,
    wrapperSize.width,
    wrapperSize.height,
    transform
  )

  return {
    x: (metrics.scrollLeft + localPoint.x - metrics.offsetX) / transform.scale,
    y: (metrics.scrollTop + localPoint.y - metrics.offsetY) / transform.scale
  }
}

const expectReaderContentPointPreserved = (
  before: ReaderPoint,
  after: ReaderPoint
) => {
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5)
}

const renderReaderZoomHarness = ({
  contentSize,
  initialTransform,
  onUpdate
}: ReaderZoomSetup): HTMLElement => {
  render(
    <WheelHarness
      enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
      initialTransform={initialTransform}
      contentSize={contentSize}
      isReaderMode
      onUpdate={onUpdate}
    />
  )

  const wrapper = screen.getByTestId('wheel-wrapper')
  const container = screen.getByTestId('wheel-container')
  mockMeasurements(wrapper, container, wrapperSize, contentSize)
  return wrapper
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
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const installPausedAnimationFrame = () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      callbacks.set(frameId, callback)
      return frameId
    })
    const cancelAnimationFrame = vi.fn((frameId: number) => {
      callbacks.delete(frameId)
    })

    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)

    return { requestAnimationFrame, cancelAnimationFrame, callbacks }
  }

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

  it('readerMode: edgeElasticScroll still leaves non-ctrl wheel on the native scroll path', () => {
    const onUpdate = vi.fn()
    const onEnd = vi.fn()
    const elasticActiveRef = { current: false }

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        isReaderMode
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onUpdate={onUpdate}
        onEnd={onEnd}
      />
    )

    const { preventDefault } = dispatchWheel(screen.getByTestId('wheel-wrapper'), {
      deltaX: -1000,
      deltaY: -700,
      ctrlKey: false
    })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(elasticActiveRef.current).toBe(false)
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

  it('readerMode: fit->fit ctrl-wheel keeps the wrapper-center content point stable', () => {
    const onUpdate = vi.fn()
    const contentSize = { width: 400, height: 300 }
    const initialTransform = { x: 0, y: 0, scale: 1 }
    const wrapper = renderReaderZoomHarness({ contentSize, initialTransform, onUpdate })
    const before = getReaderContentPoint(initialTransform, contentSize, wrapperCenter)

    dispatchWheel(wrapper, {
      clientX: 410,
      clientY: 320,
      deltaY: -100,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const after = getReaderContentPoint(next, contentSize, wrapperCenter)

    expectReaderContentPointPreserved(before, after)
  })

  it('readerMode: fit->overflow ctrl-wheel keeps the wrapper-center content point stable', () => {
    const onUpdate = vi.fn()
    const contentSize = { width: 700, height: 300 }
    const initialTransform = { x: 0, y: 0, scale: 1 }
    const wrapper = renderReaderZoomHarness({ contentSize, initialTransform, onUpdate })
    const before = getReaderContentPoint(initialTransform, contentSize, wrapperCenter)

    dispatchWheel(wrapper, {
      clientX: 410,
      clientY: 320,
      deltaY: -100,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const after = getReaderContentPoint(next, contentSize, wrapperCenter)

    expectReaderContentPointPreserved(before, after)
    expect(next.x).toBeLessThan(0)
    expect(next.y).toBe(0)
  })

  it('readerMode: overflow->overflow ctrl-wheel keeps the pointer content point stable', () => {
    const onUpdate = vi.fn()
    const contentSize = { width: 1200, height: 900 }
    const initialTransform = { x: -200, y: -150, scale: 1 }
    const wrapper = renderReaderZoomHarness({ contentSize, initialTransform, onUpdate })
    const before = getReaderContentPoint(initialTransform, contentSize, wrapperCenter)

    dispatchWheel(wrapper, {
      clientX: 410,
      clientY: 320,
      deltaY: -100,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const after = getReaderContentPoint(next, contentSize, wrapperCenter)

    expectReaderContentPointPreserved(before, after)
  })

  it('readerMode: mixed-axis ctrl-wheel preserves X overflow and Y fit anchors independently', () => {
    const onUpdate = vi.fn()
    const contentSize = { width: 1000, height: 300 }
    const initialTransform = { x: -100, y: 0, scale: 1 }
    const wrapper = renderReaderZoomHarness({ contentSize, initialTransform, onUpdate })
    const before = getReaderContentPoint(initialTransform, contentSize, wrapperCenter)

    dispatchWheel(wrapper, {
      clientX: 410,
      clientY: 320,
      deltaY: -100,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const after = getReaderContentPoint(next, contentSize, wrapperCenter)

    expectReaderContentPointPreserved(before, after)
    expect(next.x).toBeLessThan(0)
    expect(next.y).toBe(0)
  })

  it('readerMode: fit->overflow ctrl-wheel subtracts reader layout offset before anchoring', () => {
    const onUpdate = vi.fn()
    const contentSize = { width: 700, height: 300 }
    const initialTransform = { x: 0, y: 0, scale: 1 }
    const wrapper = renderReaderZoomHarness({ contentSize, initialTransform, onUpdate })

    dispatchWheel(wrapper, {
      clientX: 410,
      clientY: 320,
      deltaY: -100,
      ctrlKey: true
    })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform
    const expectedScale = Math.exp(100 * 0.002)
    const expectedScrollLeft = (contentSize.width / 2) * expectedScale - wrapperCenter.x
    const maxScrollLeft = contentSize.width * expectedScale - wrapperSize.width

    expect(next.x).toBeCloseTo(-expectedScrollLeft)
    expect(Math.abs(next.x)).toBeLessThan(maxScrollLeft)
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

  it('containMode: omitted edgeElasticScroll hard-projects trackpad pan without elastic state', () => {
    vi.useFakeTimers()
    const onUpdate = vi.fn()
    const onEnd = vi.fn()
    const elasticActiveRef = { current: false }

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        elasticActiveRef={elasticActiveRef}
        onUpdate={onUpdate}
        onEnd={onEnd}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -1000, deltaY: -700, ctrlKey: false })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: 0, y: 0, scale: 1 },
      expect.objectContaining({ source: VirtualPaperInteractionMode.TrackpadScrollPan, phase: 'change' })
    )
    expect(elasticActiveRef.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(onEnd).toHaveBeenCalledWith(
      { x: 0, y: 0, scale: 1 },
      expect.objectContaining({ source: VirtualPaperInteractionMode.TrackpadScrollPan, phase: 'end' })
    )
  })

  it('containMode: edgeElasticScroll=false hard-projects trackpad pan without elastic state', () => {
    const onUpdate = vi.fn()
    const elasticActiveRef = { current: false }

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll={false}
        elasticActiveRef={elasticActiveRef}
        onUpdate={onUpdate}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -1000, deltaY: -700, ctrlKey: false })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: 0, y: 0, scale: 1 },
      expect.objectContaining({ source: VirtualPaperInteractionMode.TrackpadScrollPan, phase: 'change' })
    )
    expect(elasticActiveRef.current).toBe(false)
  })

  it('containMode: edge-elastic trackpad pan resists overscroll and settles after wheel debounce', () => {
    vi.useFakeTimers()
    const onUpdate = vi.fn()
    const onEnd = vi.fn()
    const elasticActiveRef = { current: false }

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onUpdate={onUpdate}
        onEnd={onEnd}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -1000, deltaY: -700, ctrlKey: false })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: 550, y: 385.00000000000006, scale: 1 },
      expect.objectContaining({ source: VirtualPaperInteractionMode.TrackpadScrollPan, phase: 'change' })
    )
    expect(elasticActiveRef.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(150)
      vi.advanceTimersByTime(2000)
    })

    expect(onEnd).toHaveBeenCalledWith(
      { x: 0, y: 0, scale: 1 },
      expect.objectContaining({ source: VirtualPaperInteractionMode.TrackpadScrollPan, phase: 'end' })
    )
    expect(elasticActiveRef.current).toBe(false)
  })

  it('containMode: edge-elastic settle is cancelled when TrackpadScrollPan is disabled', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()
    const elasticActiveRef = { current: false }
    const { rerender } = render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onEnd={onEnd}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -1000, deltaY: -700, ctrlKey: false })
    expect(elasticActiveRef.current).toBe(true)

    rerender(
      <WheelHarness
        enabledInteractions={[]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onEnd={onEnd}
      />
    )

    act(() => {
      vi.advanceTimersByTime(2150)
    })

    expect(onEnd).not.toHaveBeenCalled()
    expect(elasticActiveRef.current).toBe(false)
  })

  it('containMode: edge-elastic does not alter ctrl-wheel zoom or MouseWheelZoom paths', () => {
    const ctrlUpdate = vi.fn()
    const wheelZoomUpdate = vi.fn()
    const ctrlElasticActiveRef = { current: false }
    const wheelZoomElasticActiveRef = { current: false }

    const ctrlRender = render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={ctrlElasticActiveRef}
        onUpdate={ctrlUpdate}
      />
    )
    let wrapper = screen.getByTestId('wheel-wrapper')
    let container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })
    dispatchWheel(wrapper, { deltaY: -100, ctrlKey: true })

    expect(ctrlUpdate).toHaveBeenCalledTimes(1)
    expect(ctrlUpdate.mock.calls[0][0].scale).toBeGreaterThan(1)
    expect(ctrlElasticActiveRef.current).toBe(false)
    ctrlRender.unmount()

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={wheelZoomElasticActiveRef}
        onUpdate={wheelZoomUpdate}
      />
    )
    wrapper = screen.getByTestId('wheel-wrapper')
    container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })
    dispatchWheel(wrapper, { deltaY: -100, ctrlKey: false })

    expect(wheelZoomUpdate).toHaveBeenCalledTimes(1)
    expect(wheelZoomUpdate.mock.calls[0][0].scale).toBeGreaterThan(1)
    expect(wheelZoomElasticActiveRef.current).toBe(false)
  })

  it('containMode: edge-elastic does not alter meta-wheel ctrl zoom', () => {
    const onUpdate = vi.fn()
    const elasticActiveRef = { current: false }

    render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onUpdate={onUpdate}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })
    dispatchWheel(wrapper, { deltaY: -100, metaKey: true })

    const next = onUpdate.mock.calls[0][0] as VirtualPaperTransform

    expect(next.scale).toBeGreaterThan(1)
    expect(onUpdate.mock.calls[0][1]).toEqual({
      source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
      inputType: 'wheel',
      phase: 'change'
    })
    expect(elasticActiveRef.current).toBe(false)
  })

  it('containMode: edge-elastic settle animation is cancelled on unmount', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()
    const elasticActiveRef = { current: false }
    const { requestAnimationFrame, cancelAnimationFrame } = installPausedAnimationFrame()
    const { unmount } = render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onEnd={onEnd}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -1000, deltaY: -700, ctrlKey: false })
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()

    unmount()
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(elasticActiveRef.current).toBe(false)
  })

  it('containMode: edge-elastic settle animation is cancelled when the option turns off', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()
    const elasticActiveRef = { current: false }
    const { requestAnimationFrame, cancelAnimationFrame } = installPausedAnimationFrame()
    const { rerender } = render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onEnd={onEnd}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -1000, deltaY: -700, ctrlKey: false })
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()

    rerender(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll={false}
        elasticActiveRef={elasticActiveRef}
        onEnd={onEnd}
      />
    )
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(elasticActiveRef.current).toBe(false)
  })

  it('containMode: edge-elastic settle animation is cancelled when TrackpadScrollPan is disabled after settle starts', () => {
    vi.useFakeTimers()
    const onEnd = vi.fn()
    const elasticActiveRef = { current: false }
    const { requestAnimationFrame, cancelAnimationFrame } = installPausedAnimationFrame()
    const { rerender } = render(
      <WheelHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onEnd={onEnd}
      />
    )

    const wrapper = screen.getByTestId('wheel-wrapper')
    const container = screen.getByTestId('wheel-container')
    mockMeasurements(wrapper, container, { width: 800, height: 600 }, { width: 1600, height: 1200 })

    dispatchWheel(wrapper, { deltaX: -1000, deltaY: -700, ctrlKey: false })
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()

    rerender(
      <WheelHarness
        enabledInteractions={[]}
        initialTransform={{ x: 0, y: 0, scale: 1 }}
        containMode
        edgeElasticScroll
        elasticActiveRef={elasticActiveRef}
        onEnd={onEnd}
      />
    )
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(elasticActiveRef.current).toBe(false)
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
