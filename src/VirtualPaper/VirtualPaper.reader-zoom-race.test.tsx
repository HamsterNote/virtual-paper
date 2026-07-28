import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VirtualPaper } from './VirtualPaper'
import {
  VirtualPaperInteractionMode,
  type VirtualPaperTransformUpdater
} from './types'

// multi-drag 的发布包使用 Node ESM 不支持的目录导入；本套件只替换该无关适配器，
// 真实滚轮 hook、定时器和 VirtualPaper 会话协调逻辑保持不变。
vi.mock('./useMultiDragInteractions', () => ({
  useMultiDragInteractions: vi.fn()
}))

const initialTransform = { x: 0, y: 0, scale: 1 }
const externalTransform = { x: -100, y: -200, scale: 2 }

const dispatchReaderZoom = (wrapper: HTMLElement) => {
  act(() => {
    wrapper.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 250,
        clientY: 250,
        ctrlKey: true,
        deltaY: -100
      })
    )
  })
}

const renderControlledReader = (
  transform: typeof initialTransform,
  onTransformChange: VirtualPaperTransformUpdater,
  onTransformChangeEnd: VirtualPaperTransformUpdater
) => (
  <VirtualPaper
    readerMode
    readerModeExternalZoomPreview
    readerModeZoomDebounceMs={500}
    transform={transform}
    contentSize={{ width: 1000, height: 2000 }}
    enabledInteractions={[VirtualPaperInteractionMode.MouseWheelCtrlZoom]}
    onTransformChange={onTransformChange}
    onTransformChangeEnd={onTransformChangeEnd}
  >
    <div>child</div>
  </VirtualPaper>
)

describe('VirtualPaper reader zoom session races', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('cancels an older external zoom end when an internal wheel zoom starts', () => {
    vi.useFakeTimers()
    const onTransformChange = vi.fn()
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      renderControlledReader(
        initialTransform,
        onTransformChange,
        onTransformChangeEnd
      )
    )

    rerender(
      renderControlledReader(
        externalTransform,
        onTransformChange,
        onTransformChangeEnd
      )
    )
    act(() => vi.advanceTimersByTime(200))
    dispatchReaderZoom(screen.getByTestId('virtual-paper-wrapper'))

    act(() => vi.advanceTimersByTime(300))

    expect(onTransformChangeEnd).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(200))

    expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
    expect(onTransformChangeEnd).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: expect.any(Number) }),
      expect.objectContaining({
        source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
        phase: 'end'
      })
    )
  })

  it('cancels the pending wheel end before an external zoom takes over', () => {
    vi.useFakeTimers()
    const onTransformChange = vi.fn()
    const onTransformChangeEnd = vi.fn()
    const { rerender } = render(
      renderControlledReader(
        initialTransform,
        onTransformChange,
        onTransformChangeEnd
      )
    )

    dispatchReaderZoom(screen.getByTestId('virtual-paper-wrapper'))
    rerender(
      renderControlledReader(
        externalTransform,
        onTransformChange,
        onTransformChangeEnd
      )
    )

    expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
    expect(onTransformChangeEnd).toHaveBeenLastCalledWith(
      expect.objectContaining({ scale: expect.any(Number) }),
      expect.objectContaining({
        source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
        phase: 'end'
      })
    )

    act(() => vi.advanceTimersByTime(500))

    expect(onTransformChangeEnd).toHaveBeenCalledTimes(2)
    expect(onTransformChangeEnd).toHaveBeenLastCalledWith(externalTransform, {
      source: 'controlledProp',
      inputType: 'programmatic',
      phase: 'end'
    })
  })

  it('cancels a wheel end when external takeover occurs inside the change callback', () => {
    vi.useFakeTimers()
    const onTransformChangeEnd = vi.fn()
    let takeOverExternally: (() => void) | undefined
    const onTransformChange = vi.fn(() => takeOverExternally?.())
    const { rerender } = render(
      renderControlledReader(
        initialTransform,
        onTransformChange,
        onTransformChangeEnd
      )
    )
    takeOverExternally = () => {
      takeOverExternally = undefined
      flushSync(() => {
        rerender(
          renderControlledReader(
            externalTransform,
            onTransformChange,
            onTransformChangeEnd
          )
        )
      })
    }

    dispatchReaderZoom(screen.getByTestId('virtual-paper-wrapper'))
    act(() => vi.advanceTimersByTime(500))

    expect(onTransformChangeEnd).toHaveBeenCalledTimes(2)
    expect(onTransformChangeEnd).toHaveBeenLastCalledWith(externalTransform, {
      source: 'controlledProp',
      inputType: 'programmatic',
      phase: 'end'
    })
  })
})
