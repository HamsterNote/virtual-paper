import '@testing-library/jest-dom/vitest'
// allow: SIZE_OK — The feature contract explicitly requires the E1-E11 matrix in this dedicated suite.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VirtualPaper } from './VirtualPaper'
import type {
  UseVirtualPaperInteractionArgs,
  VirtualPaperProps,
  VirtualPaperTransformMeta
} from './types'
import { VirtualPaperInteractionMode } from './types'
import { useWheelInteractions } from './useWheelInteractions'

vi.mock('./useMultiDragInteractions', () => ({
  useMultiDragInteractions: vi.fn()
}))
vi.mock('./useWheelInteractions', () => ({
  useWheelInteractions: vi.fn()
}))

const CONTENT_SIZE = { width: 1000, height: 2000 } as const
const BASE_TRANSFORM = { x: 0, y: 0, scale: 1 } as const
const ZOOM_TRANSFORM = { x: 0, y: 0, scale: 2 } as const
const CONTROLLED_META = {
  source: 'controlledProp',
  inputType: 'programmatic',
  phase: 'change'
} satisfies VirtualPaperTransformMeta
const GESTURE_META = {
  source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
  inputType: 'wheel',
  phase: 'change'
} satisfies VirtualPaperTransformMeta

const createReaderProps = (
  overrides: Partial<VirtualPaperProps> = {}
): VirtualPaperProps => ({
  readerMode: true,
  readerModeExternalZoomPreview: true,
  transform: BASE_TRANSFORM,
  contentSize: CONTENT_SIZE,
  children: <div>child</div>,
  ...overrides
})

const getLatestWheelArgs = (): UseVirtualPaperInteractionArgs => {
  const calls = vi.mocked(useWheelInteractions).mock.calls
  const args = calls[calls.length - 1]?.[0]
  if (!args) throw new Error('Expected useWheelInteractions to be called')
  return args
}

describe('VirtualPaper readerModeExternalZoomPreview', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth'
  )
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight'
  )

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 500
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 500
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientWidth',
        originalClientWidth
      )
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        originalClientHeight
      )
    }
  })

  it('E1: previews an external controlled scale change without committing layout', () => {
    // Given: a controlled reader committed at scale 1.
    const onTransformChange = vi.fn()
    const { rerender } = render(
      <VirtualPaper {...createReaderProps({ onTransformChange })} />
    )

    // When: the consumer publishes scale 2.
    rerender(
      <VirtualPaper
        {...createReaderProps({ transform: ZOOM_TRANSFORM, onTransformChange })}
      />
    )

    // Then: layout stays committed while CSS previews around the viewport center.
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('1000px')
    expect(container.style.height).toBe('2000px')
    expect(container.style.transformOrigin).toBe('250px 250px')
    expect(container.style.transform).toContain('scale(2)')
    expect(onTransformChange).toHaveBeenCalledWith(
      ZOOM_TRANSFORM,
      CONTROLLED_META
    )
  })

  it('E2: commits the external scale after the default quiet period', () => {
    // Given: an active external scale preview.
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      <VirtualPaper {...createReaderProps({ onTransformChangeEnd })} />
    )
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: ZOOM_TRANSFORM,
          onTransformChangeEnd
        })}
      />
    )

    // When: the default 500ms debounce expires.
    act(() => vi.advanceTimersByTime(500))

    // Then: the prop-backed layout commits and emits one end event.
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('2000px')
    expect(container.style.height).toBe('4000px')
    expect(container.style.transform).toBe('')
    expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
    expect(onTransformChangeEnd).toHaveBeenCalledWith(
      ZOOM_TRANSFORM,
      expect.objectContaining({ phase: 'end' })
    )
  })

  it('E3a: respects a custom external zoom debounce', () => {
    // Given: a reader configured with a 300ms quiet period.
    const { rerender } = render(
      <VirtualPaper {...createReaderProps({ readerModeZoomDebounceMs: 300 })} />
    )
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: ZOOM_TRANSFORM,
          readerModeZoomDebounceMs: 300
        })}
      />
    )

    // When/Then: preview remains at 299ms and commits at 300ms.
    act(() => vi.advanceTimersByTime(299))
    expect(screen.getByTestId('virtual-paper-container').style.width).toBe(
      '1000px'
    )
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('virtual-paper-container').style.width).toBe(
      '2000px'
    )
  })

  it('E3b: commits immediately without preview when debounce is zero', () => {
    // Given: external preview is enabled with zero debounce.
    const onTransformChange = vi.fn()
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      <VirtualPaper
        {...createReaderProps({
          readerModeZoomDebounceMs: 0,
          onTransformChange,
          onTransformChangeEnd
        })}
      />
    )

    // When: the controlled scale changes.
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: ZOOM_TRANSFORM,
          readerModeZoomDebounceMs: 0,
          onTransformChange,
          onTransformChangeEnd
        })}
      />
    )

    // Then: the new layout is immediate and no preview/change event is created.
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('2000px')
    expect(container.style.transform).toBe('')
    expect(onTransformChange).not.toHaveBeenCalled()
    expect(onTransformChangeEnd).not.toHaveBeenCalled()
  })

  it('E4: resets debounce when another external scale arrives', () => {
    // Given: a scale-2 preview has run for 400ms.
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      <VirtualPaper {...createReaderProps({ onTransformChangeEnd })} />
    )
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: ZOOM_TRANSFORM,
          onTransformChangeEnd
        })}
      />
    )
    act(() => vi.advanceTimersByTime(400))

    // When: scale 3 arrives and another 400ms passes.
    const latest = { x: 0, y: 0, scale: 3 }
    rerender(
      <VirtualPaper
        {...createReaderProps({ transform: latest, onTransformChangeEnd })}
      />
    )
    act(() => vi.advanceTimersByTime(400))

    // Then: it remains previewing until the reset timer reaches 500ms.
    expect(screen.getByTestId('virtual-paper-container').style.width).toBe(
      '1000px'
    )
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByTestId('virtual-paper-container').style.width).toBe(
      '3000px'
    )
    expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
  })

  it('E5: suppresses a controlled echo of an internal zoom preview', () => {
    // Given: an internal gesture has emitted a reader zoom preview.
    const onTransformChange = vi.fn()
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      <VirtualPaper
        {...createReaderProps({ onTransformChange, onTransformChangeEnd })}
      />
    )
    const wheelArgs = getLatestWheelArgs()
    act(() => {
      wheelArgs.previewReaderZoom?.(
        { transform: ZOOM_TRANSFORM, origin: { x: 100, y: 120 } },
        GESTURE_META
      )
    })

    // When: the consumer echoes it with an idempotent sub-epsilon scale clamp.
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: { ...ZOOM_TRANSFORM, scale: 2.0000005 },
          onTransformChange,
          onTransformChangeEnd
        })}
      />
    )
    act(() => vi.advanceTimersByTime(500))

    // Then: no external session or duplicate change event is created.
    expect(onTransformChange).toHaveBeenCalledTimes(1)
    expect(onTransformChangeEnd).not.toHaveBeenCalled()
  })

  it('E6: applies x/y-only controlled changes without preview events', () => {
    // Given: a controlled reader at scale 1.
    const onTransformChange = vi.fn()
    const { rerender } = render(
      <VirtualPaper {...createReaderProps({ onTransformChange })} />
    )

    // When: only the controlled scroll coordinates change.
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: { x: -100, y: -200, scale: 1 },
          onTransformChange
        })}
      />
    )

    // Then: native scroll applies immediately with no CSS preview or callback.
    expect(screen.getByTestId('virtual-paper-wrapper').scrollLeft).toBe(100)
    expect(screen.getByTestId('virtual-paper-wrapper').scrollTop).toBe(200)
    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      ''
    )
    expect(onTransformChange).not.toHaveBeenCalled()
  })

  it('E7: preserves immediate controlled commits when the prop is omitted', () => {
    // Given: the opt-in prop is omitted.
    const { rerender } = render(
      <VirtualPaper
        readerMode
        transform={BASE_TRANSFORM}
        contentSize={CONTENT_SIZE}
      />
    )

    // When: the consumer changes scale.
    rerender(
      <VirtualPaper
        readerMode
        transform={ZOOM_TRANSFORM}
        contentSize={CONTENT_SIZE}
      />
    )

    // Then: current immediate layout behavior is unchanged.
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('2000px')
    expect(container.style.transform).toBe('')
  })

  it('E8: ignores external preview mode for an uncontrolled reader', () => {
    // Given/When: preview is enabled without a controlled transform prop.
    expect(() =>
      render(
        <VirtualPaper
          readerMode
          readerModeExternalZoomPreview
          defaultTransform={BASE_TRANSFORM}
          contentSize={CONTENT_SIZE}
        />
      )
    ).not.toThrow()

    // Then: it renders committed layout without preview styles.
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('1000px')
    expect(container.style.transform).toBe('')
  })

  it('E9: ignores external preview mode outside readerMode', () => {
    // Given: a controlled transform-mode paper with the opt-in prop set.
    const onTransformChange = vi.fn()
    const { rerender } = render(
      <VirtualPaper
        readerModeExternalZoomPreview
        transform={BASE_TRANSFORM}
        onTransformChange={onTransformChange}
      />
    )

    // When: the controlled scale changes.
    rerender(
      <VirtualPaper
        readerModeExternalZoomPreview
        transform={ZOOM_TRANSFORM}
        onTransformChange={onTransformChange}
      />
    )

    // Then: the normal transform renderer applies it without feature callbacks.
    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(0px, 0px, 0) scale(2)'
    )
    expect(onTransformChange).not.toHaveBeenCalled()
  })

  it('E10: commits an internal gesture before starting an external preview', () => {
    // Given: an internal gesture is previewing scale 1.5.
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      <VirtualPaper {...createReaderProps({ onTransformChangeEnd })} />
    )
    const gestureTarget = { x: -100, y: -200, scale: 1.5 }
    const wheelArgs = getLatestWheelArgs()
    act(() => {
      wheelArgs.previewReaderZoom?.(
        { transform: gestureTarget, origin: { x: 100, y: 120 } },
        GESTURE_META
      )
    })

    // When: a distinct external scale arrives during that gesture preview.
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: ZOOM_TRANSFORM,
          onTransformChangeEnd
        })}
      />
    )

    // Then: the gesture commits once and becomes the external preview base.
    expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
    expect(onTransformChangeEnd).toHaveBeenCalledWith(
      gestureTarget,
      expect.objectContaining({ source: 'MouseWheelCtrlZoom', phase: 'end' })
    )
    expect(screen.getByTestId('virtual-paper-container').style.width).toBe(
      '1500px'
    )
    expect(
      screen.getByTestId('virtual-paper-container').style.transform
    ).not.toBe('')
  })

  it('E11: commits the base layout when scale returns before debounce', () => {
    // Given: an external scale-2 preview is active.
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      <VirtualPaper {...createReaderProps({ onTransformChangeEnd })} />
    )
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: ZOOM_TRANSFORM,
          onTransformChangeEnd
        })}
      />
    )

    // When: the controlled scale returns to base before the timer expires.
    act(() => vi.advanceTimersByTime(250))
    rerender(
      <VirtualPaper
        {...createReaderProps({
          transform: BASE_TRANSFORM,
          onTransformChangeEnd
        })}
      />
    )
    act(() => vi.advanceTimersByTime(500))

    // Then: the original dimensions are committed and preview styles clear.
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.width).toBe('1000px')
    expect(container.style.height).toBe('2000px')
    expect(container.style.transform).toBe('')
    expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
    expect(onTransformChangeEnd).toHaveBeenCalledWith(
      BASE_TRANSFORM,
      expect.objectContaining({ phase: 'end' })
    )
  })
})
