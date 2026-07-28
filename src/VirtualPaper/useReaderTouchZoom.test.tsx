import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReaderTouchZoom } from './useReaderTouchZoom'
import {
  VirtualPaperInteractionMode,
  type VirtualPaperReaderZoomPreviewUpdater,
  type VirtualPaperReaderZoomSessionCancelRegistrar,
  type VirtualPaperTransformUpdater,
  type VirtualPaperTransform
} from './types'

type TouchInput = {
  readonly identifier: number
  readonly clientX: number
  readonly clientY: number
}

type HarnessProps = {
  readonly transform?: VirtualPaperTransform
  readonly enabled?: boolean
  readonly previewReaderZoom?: VirtualPaperReaderZoomPreviewUpdater
  readonly registerReaderZoomSessionCancel?: VirtualPaperReaderZoomSessionCancelRegistrar
  readonly endTransform?: VirtualPaperTransformUpdater
}

function TestHarness({
  transform = { x: 0, y: 0, scale: 1 },
  enabled = true,
  previewReaderZoom = vi.fn<VirtualPaperReaderZoomPreviewUpdater>(),
  registerReaderZoomSessionCancel,
  endTransform = vi.fn<VirtualPaperTransformUpdater>()
}: HarnessProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useReaderTouchZoom({
    wrapperRef,
    enabled,
    transform,
    minScale: 0.25,
    maxScale: 4,
    contentSize: { width: 1000, height: 1000 },
    previewReaderZoom,
    registerReaderZoomSessionCancel,
    endTransform
  })

  return <div ref={wrapperRef} data-testid="wrapper" />
}

const dispatchTouches = (
  element: HTMLElement,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
  touches: readonly TouchInput[]
) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: touches })
  element.dispatchEvent(event)
}

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
  return { callbacks, requestAnimationFrame, cancelAnimationFrame }
}

describe('useReaderTouchZoom', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('leaves a single touch entirely to native scrolling', () => {
    const previewReaderZoom = vi.fn()
    const endTransform = vi.fn()
    render(
      <TestHarness
        previewReaderZoom={previewReaderZoom}
        endTransform={endTransform}
      />
    )
    const wrapper = screen.getByTestId('wrapper')

    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 1, clientX: 100, clientY: 100 }
    ])
    dispatchTouches(wrapper, 'touchmove', [
      { identifier: 1, clientX: 100, clientY: 40 }
    ])
    dispatchTouches(wrapper, 'touchend', [])

    expect(previewReaderZoom).not.toHaveBeenCalled()
    expect(endTransform).not.toHaveBeenCalled()
  })

  it('publishes only the latest reversible pinch pose in each frame', () => {
    const { callbacks } = installPausedAnimationFrame()
    const previewReaderZoom = vi.fn()
    render(<TestHarness previewReaderZoom={previewReaderZoom} />)
    const wrapper = screen.getByTestId('wrapper')
    Object.defineProperty(wrapper, 'clientWidth', { value: 500 })
    Object.defineProperty(wrapper, 'clientHeight', { value: 400 })

    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 1, clientX: 100, clientY: 100 },
      { identifier: 2, clientX: 300, clientY: 100 }
    ])
    dispatchTouches(wrapper, 'touchmove', [
      { identifier: 1, clientX: 80, clientY: 140 },
      { identifier: 2, clientX: 320, clientY: 140 }
    ])
    dispatchTouches(wrapper, 'touchmove', [
      { identifier: 1, clientX: 150, clientY: 140 },
      { identifier: 2, clientX: 250, clientY: 140 }
    ])

    expect(previewReaderZoom).not.toHaveBeenCalled()
    expect(callbacks).toHaveLength(1)
    const [[, flushFrame]] = [...callbacks]
    act(() => flushFrame(16))

    expect(previewReaderZoom).toHaveBeenCalledTimes(1)
    expect(previewReaderZoom).toHaveBeenCalledWith(
      {
        transform: { x: 0, y: 0, scale: 0.5 },
        origin: { x: 200, y: 100 }
      },
      {
        source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
        inputType: 'pointer',
        phase: 'change',
        originalEventType: 'touchmove'
      }
    )
  })

  it('keeps the original two-touch pair when a third touch joins', () => {
    const { callbacks } = installPausedAnimationFrame()
    const previewReaderZoom = vi.fn()
    render(<TestHarness previewReaderZoom={previewReaderZoom} />)
    const wrapper = screen.getByTestId('wrapper')
    Object.defineProperty(wrapper, 'clientWidth', { value: 500 })
    Object.defineProperty(wrapper, 'clientHeight', { value: 400 })

    // Given: 双指缩放由 identifier 10 和 11 开始。
    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 10, clientX: 100, clientY: 100 },
      { identifier: 11, clientX: 300, clientY: 100 }
    ])

    // When: identifier 更小的第三根手指加入，原双指继续拉开到 1.2 倍。
    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 1, clientX: 0, clientY: 100 },
      { identifier: 10, clientX: 100, clientY: 100 },
      { identifier: 11, clientX: 300, clientY: 100 }
    ])
    dispatchTouches(wrapper, 'touchmove', [
      { identifier: 1, clientX: 0, clientY: 100 },
      { identifier: 10, clientX: 80, clientY: 100 },
      { identifier: 11, clientX: 320, clientY: 100 }
    ])
    const [[, flushFrame]] = [...callbacks]
    act(() => flushFrame(16))

    // Then: 第三指不替换手势起始 pair，也不会造成比例突变。
    expect(previewReaderZoom).toHaveBeenCalledWith(
      {
        transform: { x: -40, y: -20, scale: 1.2 },
        origin: { x: 200, y: 100 }
      },
      expect.objectContaining({ phase: 'change' })
    )
  })

  it('commits the latest transform immediately when the pinch ends', () => {
    const { requestAnimationFrame, cancelAnimationFrame } =
      installPausedAnimationFrame()
    const previewReaderZoom = vi.fn()
    const endTransform = vi.fn()
    render(
      <TestHarness
        previewReaderZoom={previewReaderZoom}
        endTransform={endTransform}
      />
    )
    const wrapper = screen.getByTestId('wrapper')
    Object.defineProperty(wrapper, 'clientWidth', { value: 500 })
    Object.defineProperty(wrapper, 'clientHeight', { value: 400 })

    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 1, clientX: 100, clientY: 100 },
      { identifier: 2, clientX: 300, clientY: 100 }
    ])
    dispatchTouches(wrapper, 'touchmove', [
      { identifier: 1, clientX: 0, clientY: 100 },
      { identifier: 2, clientX: 400, clientY: 100 }
    ])
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)

    dispatchTouches(wrapper, 'touchend', [
      { identifier: 2, clientX: 400, clientY: 100 }
    ])

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(previewReaderZoom).not.toHaveBeenCalled()
    expect(endTransform).toHaveBeenCalledTimes(1)
    expect(endTransform).toHaveBeenCalledWith(
      { x: -200, y: -100, scale: 2 },
      {
        source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
        inputType: 'pointer',
        phase: 'end',
        originalEventType: 'touchend'
      }
    )
  })

  it('does not end an active touch segment after external cancellation', () => {
    const endTransform = vi.fn()
    let cancelActiveSession: (() => void) | undefined
    const registerReaderZoomSessionCancel = vi.fn((cancel: () => void) => {
      cancelActiveSession = cancel
      return () => {
        cancelActiveSession = undefined
      }
    })
    render(
      <TestHarness
        registerReaderZoomSessionCancel={registerReaderZoomSessionCancel}
        endTransform={endTransform}
      />
    )
    const wrapper = screen.getByTestId('wrapper')

    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 1, clientX: 100, clientY: 100 },
      { identifier: 2, clientX: 200, clientY: 200 }
    ])
    act(() => cancelActiveSession?.())
    dispatchTouches(wrapper, 'touchend', [])

    expect(registerReaderZoomSessionCancel).toHaveBeenCalledTimes(1)
    expect(endTransform).not.toHaveBeenCalled()
  })

  it('starts the next pinch from the latest transform after cancellation', () => {
    const { callbacks } = installPausedAnimationFrame()
    const previewReaderZoom = vi.fn()
    let cancelActiveSession: (() => void) | undefined
    const registerReaderZoomSessionCancel = (cancel: () => void) => {
      cancelActiveSession = cancel
      return () => {
        cancelActiveSession = undefined
      }
    }
    const { rerender } = render(
      <TestHarness
        previewReaderZoom={previewReaderZoom}
        registerReaderZoomSessionCancel={registerReaderZoomSessionCancel}
      />
    )
    const wrapper = screen.getByTestId('wrapper')
    Object.defineProperty(wrapper, 'clientWidth', { value: 500 })
    Object.defineProperty(wrapper, 'clientHeight', { value: 400 })

    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 1, clientX: 100, clientY: 100 },
      { identifier: 2, clientX: 300, clientY: 100 }
    ])
    rerender(
      <TestHarness
        transform={{ x: 0, y: 0, scale: 2 }}
        previewReaderZoom={previewReaderZoom}
        registerReaderZoomSessionCancel={registerReaderZoomSessionCancel}
      />
    )
    act(() => cancelActiveSession?.())

    dispatchTouches(wrapper, 'touchstart', [
      { identifier: 1, clientX: 100, clientY: 100 },
      { identifier: 2, clientX: 300, clientY: 100 }
    ])
    dispatchTouches(wrapper, 'touchmove', [
      { identifier: 1, clientX: 0, clientY: 100 },
      { identifier: 2, clientX: 400, clientY: 100 }
    ])
    const [[, flushFrame]] = [...callbacks]
    act(() => flushFrame(16))

    expect(previewReaderZoom).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transform: expect.objectContaining({ scale: 4 })
      }),
      expect.objectContaining({ phase: 'change' })
    )
  })
})
