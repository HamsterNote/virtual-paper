import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { StrictMode } from 'react'
import { VirtualPaper } from './VirtualPaper'
import {
  DEFAULT_ENABLED_INTERACTIONS,
  VirtualPaperInitialPlacement,
  VirtualPaperInteractionMode
} from './types'
import { useMultiDragInteractions } from './useMultiDragInteractions'
import { useWheelInteractions } from './useWheelInteractions'

// allow: SIZE_OK — Existing component regression matrix is intentionally kept together;
// splitting the suite is a separate behavior-preserving refactor outside this test-only task.

vi.mock('./useMultiDragInteractions', () => ({
  useMultiDragInteractions: vi.fn()
}))

vi.mock('./useWheelInteractions', () => ({
  useWheelInteractions: vi.fn()
}))

const getLatestWheelArgs = () => {
  const calls = vi.mocked(useWheelInteractions).mock.calls
  return calls[calls.length - 1][0]
}

const getLatestMultiDragArgs = () => {
  const calls = vi.mocked(useMultiDragInteractions).mock.calls
  return calls[calls.length - 1][0]
}

type MockElementSize = { width: number; height: number }

describe('VirtualPaper', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

  const createDOMRect = ({ width, height }: MockElementSize) =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() {
        return this
      }
    }) as unknown as DOMRect

  const mockVirtualPaperRectSizes = (sizes: {
    wrapper: MockElementSize
    container: MockElementSize
  }) => {
    Element.prototype.getBoundingClientRect = function () {
      const testId = this.getAttribute('data-testid')
      if (testId === 'virtual-paper-wrapper')
        return createDOMRect(sizes.wrapper)
      if (testId === 'virtual-paper-container')
        return createDOMRect(sizes.container)
      return originalGetBoundingClientRect.call(this)
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockVirtualPaperRectSizes({
      wrapper: { width: 800, height: 600 },
      container: { width: 400, height: 300 }
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  })

  it('renders wrapper and container around children', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('virtual-paper-container')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('applies default uncontrolled center placement after layout measurement', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(1)'
    )
  })

  it('places container at top left when initialPlacement is TopLeft', () => {
    render(
      <VirtualPaper initialPlacement={VirtualPaperInitialPlacement.TopLeft}>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
  })

  it('containMode initial center overrides TopLeft when container fits', () => {
    render(
      <VirtualPaper
        containMode
        initialPlacement={VirtualPaperInitialPlacement.TopLeft}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(1)'
    )
  })

  it('containMode clamps an oversized defaultTransform into legal range', () => {
    mockVirtualPaperRectSizes({
      wrapper: { width: 800, height: 600 },
      container: { width: 1000, height: 900 }
    })

    render(
      <VirtualPaper containMode defaultTransform={{ x: 999, y: -999 }}>
        <div>child</div>
      </VirtualPaper>
    )

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(0px, -300px, 0) scale(1)'
    )
  })

  it('updates container transform when controlled prop changes', () => {
    const { rerender } = render(
      <VirtualPaper transform={{ x: 10, y: 20, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(10px, 20px, 0) scale(1)'
    )

    rerender(
      <VirtualPaper transform={{ x: 50, y: 100, scale: 2 }}>
        <div>child</div>
      </VirtualPaper>
    )
    expect(container.style.transform).toBe(
      'translate3d(50px, 100px, 0) scale(2)'
    )
  })

  it('does not throw on unmount under StrictMode', () => {
    const { unmount } = render(
      <StrictMode>
        <VirtualPaper>
          <div>child</div>
        </VirtualPaper>
      </StrictMode>
    )
    expect(() => unmount()).not.toThrow()
  })

  it('merges wrapper className in correct order', () => {
    render(
      <VirtualPaper
        className="user-wrapper"
        wrapperProps={{ className: 'prop-wrapper' }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.className).toBe(
      'virtual-paper-wrapper user-wrapper prop-wrapper'
    )
  })

  it('lets wrapperProps className and style override top-level wrapper props', () => {
    render(
      <VirtualPaper
        className="user-wrapper"
        style={{ width: '75%', overflow: 'auto', backgroundColor: 'red' }}
        wrapperProps={{
          className: 'prop-wrapper',
          style: { width: '50%', overflow: 'visible' }
        }}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.className).toBe(
      'virtual-paper-wrapper user-wrapper prop-wrapper'
    )
    expect(wrapper.style.width).toBe('50%')
    expect(wrapper.style.overflow).toBe('visible')
    expect(wrapper.style.backgroundColor).toBe('red')
  })

  it('merges container className in correct order', () => {
    render(
      <VirtualPaper
        containerClassName="user-container"
        containerProps={{ className: 'prop-container' }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.className).toBe(
      'virtual-paper-container user-container prop-container'
    )
  })

  it('lets containerProps className and style override container props except owned transform styles', () => {
    render(
      <VirtualPaper
        containerClassName="user-container"
        containerStyle={{ touchAction: 'auto', color: 'red' }}
        containerProps={{
          className: 'prop-container',
          style: {
            touchAction: 'pan-x',
            color: 'blue',
            transform: 'rotate(45deg)',
            transformOrigin: 'center'
          }
        }}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.className).toBe(
      'virtual-paper-container user-container prop-container'
    )
    expect(container.style.touchAction).toBe('pan-x')
    expect(container.style.color).toBe('blue')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(1)'
    )
    expect(container.style.transformOrigin).toBe('0 0')
  })

  it('applies base wrapper styles', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )
    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper.style.position).toBe('relative')
    expect(wrapper.style.overflow).toBe('hidden')
    expect(wrapper.style.width).toBe('100%')
    expect(wrapper.style.height).toBe('100%')
  })

  it('applies base container styles', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.position).toBe('absolute')
    expect(container.style.willChange).toBe('')
    expect(container.style.touchAction).toBe('none')
    expect(container.style.userSelect).toBe('text')
  })

  it('disables userSelect on container when MouseDragPan is enabled', () => {
    render(
      <VirtualPaper
        enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.userSelect).toBe('none')
  })

  it('enables text selection on container when MouseDragPan is not enabled', () => {
    render(
      <VirtualPaper
        enabledInteractions={[VirtualPaperInteractionMode.TouchSingleFingerPan]}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.userSelect).toBe('text')
  })

  it('calls onTransformChange in uncontrolled mode on initial placement', () => {
    const onTransformChange = vi.fn()
    render(
      <VirtualPaper onTransformChange={onTransformChange}>
        <div>child</div>
      </VirtualPaper>
    )
    expect(onTransformChange).toHaveBeenCalledWith(
      { x: 200, y: 150, scale: 1 },
      expect.objectContaining({
        source: 'initialPlacement',
        inputType: 'programmatic',
        phase: 'change'
      })
    )
  })

  it('ignores defaultTransform and initialPlacement in controlled mode', () => {
    render(
      <VirtualPaper
        transform={{ x: 42, y: 24, scale: 1.5 }}
        initialPlacement={VirtualPaperInitialPlacement.TopLeft}
        defaultTransform={{ x: 100, y: 100 }}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(42px, 24px, 0) scale(1.5)'
    )
  })

  it('merges defaultTransform in uncontrolled mode', () => {
    render(
      <VirtualPaper defaultTransform={{ scale: 2 }}>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(2)'
    )
  })

  it('clamps defaultTransform scale to minScale and maxScale', () => {
    render(
      <VirtualPaper
        defaultTransform={{ scale: 10 }}
        minScale={0.25}
        maxScale={4}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(4)'
    )
  })

  it('clamps defaultTransform scale up to minScale in the component', () => {
    render(
      <VirtualPaper
        defaultTransform={{ scale: 0.1 }}
        minScale={0.5}
        maxScale={4}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(0.5)'
    )
  })

  it('passes custom scale limits to interaction hooks', () => {
    render(
      <VirtualPaper minScale={0.5} maxScale={3}>
        <div>child</div>
      </VirtualPaper>
    )

    expect(getLatestWheelArgs().minScale).toBe(0.5)
    expect(getLatestWheelArgs().maxScale).toBe(3)
    expect(getLatestMultiDragArgs().minScale).toBe(0.5)
    expect(getLatestMultiDragArgs().maxScale).toBe(3)
  })

  it('does not call onTransformChange in controlled mode on mount', () => {
    const onTransformChange = vi.fn()
    render(
      <VirtualPaper
        transform={{ x: 0, y: 0, scale: 1 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )
    expect(onTransformChange).not.toHaveBeenCalled()
  })

  it('containMode projects a controlled illegal transform without firing onTransformChange from render', () => {
    const onTransformChange = vi.fn()
    const transform = { x: 999, y: -999, scale: 1 }

    render(
      <VirtualPaper
        containMode
        transform={transform}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(1)'
    )
    expect(onTransformChange).not.toHaveBeenCalled()
    expect(transform).toEqual({ x: 999, y: -999, scale: 1 })
  })

  it('does not persist hook updates internally in controlled mode', () => {
    const onTransformChange = vi.fn()
    const { rerender } = render(
      <VirtualPaper
        transform={{ x: 0, y: 0, scale: 1 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )

    act(() => {
      getLatestWheelArgs().updateTransform(
        { x: 99, y: 88, scale: 2 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    })

    const container = screen.getByTestId('virtual-paper-container')
    expect(onTransformChange).toHaveBeenCalledWith(
      { x: 99, y: 88, scale: 2 },
      expect.objectContaining({
        source: VirtualPaperInteractionMode.TrackpadScrollPan,
        phase: 'change'
      })
    )
    expect(container.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')

    rerender(
      <VirtualPaper
        transform={{ x: 5, y: 6, scale: 1.5 }}
        onTransformChange={onTransformChange}
      >
        <div>child</div>
      </VirtualPaper>
    )
    expect(container.style.transform).toBe(
      'translate3d(5px, 6px, 0) scale(1.5)'
    )
  })

  it('updates internal state and forwards meta for hook changes in uncontrolled mode', () => {
    const onTransformChange = vi.fn()
    render(
      <VirtualPaper onTransformChange={onTransformChange}>
        <div>child</div>
      </VirtualPaper>
    )
    onTransformChange.mockClear()

    act(() => {
      getLatestWheelArgs().updateTransform(
        { x: 25, y: 35, scale: 1.25 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    })

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(25px, 35px, 0) scale(1.25)'
    )
    expect(onTransformChange).toHaveBeenCalledWith(
      { x: 25, y: 35, scale: 1.25 },
      {
        source: VirtualPaperInteractionMode.TrackpadScrollPan,
        inputType: 'wheel',
        phase: 'change'
      }
    )
  })

  it('forwards callback meta source for different interaction modes', () => {
    const onTransformChange = vi.fn()
    render(
      <VirtualPaper onTransformChange={onTransformChange}>
        <div>child</div>
      </VirtualPaper>
    )
    onTransformChange.mockClear()

    act(() => {
      getLatestWheelArgs().updateTransform(
        { x: 10, y: 20, scale: 1 },
        {
          source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
          inputType: 'wheel',
          phase: 'change'
        }
      )
      getLatestMultiDragArgs().updateTransform(
        { x: 15, y: 25, scale: 2 },
        {
          source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
          inputType: 'pointer',
          phase: 'change'
        }
      )
    })

    expect(onTransformChange).toHaveBeenNthCalledWith(
      1,
      { x: 10, y: 20, scale: 1 },
      expect.objectContaining({
        source: VirtualPaperInteractionMode.MouseWheelCtrlZoom
      })
    )
    expect(onTransformChange).toHaveBeenNthCalledWith(
      2,
      { x: 15, y: 25, scale: 2 },
      expect.objectContaining({
        source: VirtualPaperInteractionMode.TouchTwoFingerZoom
      })
    )
  })

  it('calls onTransformChangeEnd and updates uncontrolled state on interaction end', () => {
    const onTransformChangeEnd = vi.fn()
    render(
      <VirtualPaper onTransformChangeEnd={onTransformChangeEnd}>
        <div>child</div>
      </VirtualPaper>
    )

    act(() => {
      getLatestWheelArgs().endTransform(
        { x: 40, y: 50, scale: 1.5 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'end'
        }
      )
    })

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(40px, 50px, 0) scale(1.5)'
    )
    expect(onTransformChangeEnd).toHaveBeenCalledWith(
      { x: 40, y: 50, scale: 1.5 },
      {
        source: VirtualPaperInteractionMode.TrackpadScrollPan,
        inputType: 'wheel',
        phase: 'end'
      }
    )
  })

  it('wrapper has default data-testid', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
  })

  it('container has default data-testid', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )
    expect(screen.getByTestId('virtual-paper-container')).toBeInTheDocument()
  })

  it('accepts custom data-testid from wrapperProps and containerProps', () => {
    render(
      <VirtualPaper
        wrapperProps={
          {
            'data-testid': 'custom-wrapper'
          } as React.HTMLAttributes<HTMLDivElement>
        }
        containerProps={
          {
            'data-testid': 'custom-container'
          } as React.HTMLAttributes<HTMLDivElement>
        }
      >
        <div>child</div>
      </VirtualPaper>
    )
    expect(screen.getByTestId('custom-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('custom-container')).toBeInTheDocument()
  })

  it('does not allow overriding container transformOrigin', () => {
    render(
      <VirtualPaper containerStyle={{ transformOrigin: 'center' }}>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transformOrigin).toBe('0 0')
  })

  it('wires gesture hooks with correct args', () => {
    render(
      <VirtualPaper transform={{ x: 0, y: 0, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )
    expect(useMultiDragInteractions).toHaveBeenCalledTimes(1)
    expect(useWheelInteractions).toHaveBeenCalledTimes(1)

    const multiDragArgs = vi.mocked(useMultiDragInteractions).mock.calls[0][0]
    const wheelArgs = vi.mocked(useWheelInteractions).mock.calls[0][0]

    const expectedKeys = [
      'wrapperRef',
      'containerRef',
      'transform',
      'enabledInteractions',
      'minScale',
      'maxScale',
      'updateTransform',
      'endTransform'
    ]

    for (const key of expectedKeys) {
      expect(multiDragArgs).toHaveProperty(key)
      expect(wheelArgs).toHaveProperty(key)
    }
  })

  it('uses the exact default enabled interactions when none are provided', () => {
    render(
      <VirtualPaper transform={{ x: 0, y: 0, scale: 1 }}>
        <div>child</div>
      </VirtualPaper>
    )

    const expectedDefaults = [
      VirtualPaperInteractionMode.TrackpadScrollPan,
      VirtualPaperInteractionMode.MouseWheelCtrlZoom,
      VirtualPaperInteractionMode.TouchSingleFingerPan,
      VirtualPaperInteractionMode.TouchTwoFingerZoom
    ]

    expect(DEFAULT_ENABLED_INTERACTIONS).toEqual(expectedDefaults)
    expect(getLatestWheelArgs().enabledInteractions).toBe(
      DEFAULT_ENABLED_INTERACTIONS
    )
    expect(getLatestMultiDragArgs().enabledInteractions).toBe(
      DEFAULT_ENABLED_INTERACTIONS
    )
  })

  it('passes containMode: false to hooks by default', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )

    expect(getLatestMultiDragArgs().containMode).toBe(false)
    expect(getLatestWheelArgs().containMode).toBe(false)
  })

  it('passes containMode: true to hooks when prop is true in non-reader mode', () => {
    render(
      <VirtualPaper containMode>
        <div>child</div>
      </VirtualPaper>
    )

    expect(getLatestMultiDragArgs().containMode).toBe(true)
    expect(getLatestWheelArgs().containMode).toBe(true)
  })

  it('passes containMode: false to hooks in reader mode even when prop is true', () => {
    render(
      <VirtualPaper
        containMode
        readerMode
        contentSize={{ width: 400, height: 300 }}
      >
        <div>child</div>
      </VirtualPaper>
    )

    expect(getLatestMultiDragArgs().containMode).toBe(false)
    expect(getLatestWheelArgs().containMode).toBe(false)
  })

  it('passes scroll opt-in switches as false to hooks by default', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )

    expect(getLatestMultiDragArgs().edgeElasticScroll).toBe(false)
    expect(getLatestWheelArgs().edgeElasticScroll).toBe(false)
  })

  it('passes true scroll opt-in switches through to both hooks', () => {
    render(
      <VirtualPaper edgeElasticScroll>
        <div>child</div>
      </VirtualPaper>
    )

    expect(getLatestMultiDragArgs().edgeElasticScroll).toBe(true)
    expect(getLatestWheelArgs().edgeElasticScroll).toBe(true)
  })

  it('renders raw contain transform only while elastic is active', () => {
    mockVirtualPaperRectSizes({
      wrapper: { width: 800, height: 600 },
      container: { width: 1000, height: 900 }
    })

    render(
      <VirtualPaper
        containMode
        edgeElasticScroll
        initialPlacement={VirtualPaperInitialPlacement.TopLeft}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')

    expect(container.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')

    act(() => {
      getLatestWheelArgs().incrementElasticActive?.()
      getLatestWheelArgs().updateTransform(
        { x: 999, y: -999, scale: 1 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    })

    expect(container.style.transform).toBe(
      'translate3d(999px, -999px, 0) scale(1)'
    )

    act(() => {
      getLatestWheelArgs().decrementElasticActive?.()
      getLatestWheelArgs().endTransform(
        { x: 0, y: -300, scale: 1 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'end'
        }
      )
    })

    expect(container.style.transform).toBe(
      'translate3d(0px, -300px, 0) scale(1)'
    )
  })

  it('renders active edge-elastic overshoot instead of the default contain projection', () => {
    mockVirtualPaperRectSizes({
      wrapper: { width: 800, height: 600 },
      container: { width: 1000, height: 900 }
    })

    render(
      <VirtualPaper
        containMode
        edgeElasticScroll
        initialPlacement={VirtualPaperInitialPlacement.TopLeft}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')

    act(() => {
      getLatestWheelArgs().incrementElasticActive?.()
      getLatestWheelArgs().updateTransform(
        { x: 550, y: 385, scale: 1 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    })

    expect(container.style.transform).toBe(
      'translate3d(550px, 385px, 0) scale(1)'
    )
  })

  it('default edgeElasticScroll off keeps contain projection', () => {
    mockVirtualPaperRectSizes({
      wrapper: { width: 800, height: 600 },
      container: { width: 1000, height: 900 }
    })

    render(
      <VirtualPaper
        containMode
        initialPlacement={VirtualPaperInitialPlacement.TopLeft}
      >
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')

    act(() => {
      getLatestWheelArgs().updateTransform(
        { x: 550, y: 385, scale: 1 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )
    })

    expect(container.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
  })

  it('re-projects display transform on ResizeObserver and window resize without firing onTransformChange', () => {
    const sizes = {
      wrapper: { width: 800, height: 600 },
      container: { width: 400, height: 300 }
    }
    mockVirtualPaperRectSizes(sizes)

    let resizeObserverCallback: ResizeObserverCallback | undefined
    class MockResizeObserver {
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()

      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback
      }
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    const observedChange = vi.fn()
    const observedRender = render(
      <VirtualPaper containMode onTransformChange={observedChange}>
        <div>child</div>
      </VirtualPaper>
    )

    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(1)'
    )
    observedChange.mockClear()

    act(() => {
      sizes.wrapper = { width: 1000, height: 900 }
      resizeObserverCallback?.([], {} as ResizeObserver)
    })

    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(300px, 300px, 0) scale(1)'
    )
    expect(observedChange).not.toHaveBeenCalled()
    observedRender.unmount()

    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', undefined)
    sizes.wrapper = { width: 800, height: 600 }
    sizes.container = { width: 400, height: 300 }
    const fallbackChange = vi.fn()
    render(
      <VirtualPaper containMode onTransformChange={fallbackChange}>
        <div>child</div>
      </VirtualPaper>
    )

    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(1)'
    )
    fallbackChange.mockClear()

    act(() => {
      sizes.wrapper = { width: 1000, height: 900 }
      window.dispatchEvent(new Event('resize'))
    })

    expect(screen.getByTestId('virtual-paper-container').style.transform).toBe(
      'translate3d(300px, 300px, 0) scale(1)'
    )
    expect(fallbackChange).not.toHaveBeenCalled()
  })

  it('default (no containMode prop) keeps existing center placement behavior', () => {
    render(
      <VirtualPaper>
        <div>child</div>
      </VirtualPaper>
    )
    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(200px, 150px, 0) scale(1)'
    )
  })

  it('containMode={false} renders raw controlled transform without projection', () => {
    const transform = { x: 999, y: -999, scale: 1 }

    render(
      <VirtualPaper containMode={false} transform={transform}>
        <div>child</div>
      </VirtualPaper>
    )

    const container = screen.getByTestId('virtual-paper-container')
    expect(container.style.transform).toBe(
      'translate3d(999px, -999px, 0) scale(1)'
    )
  })

  describe('lazyWillChange', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('default lazyWillChange={0} leaves willChange empty', () => {
      render(
        <VirtualPaper lazyWillChange={0}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')
      expect(container.style.willChange).toBe('')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })
      expect(container.style.willChange).toBe('')
    })

    it('sets will-change to transform while updateTransform is active', () => {
      render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')
      expect(container.style.willChange).toBe('')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })

      expect(container.style.willChange).toBe('transform')
    })

    it('enables will-change on a wheel zoom update', () => {
      render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')
      expect(container.style.willChange).toBe('')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 0, y: 0, scale: 1.5 },
          {
            source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })

      expect(container.style.willChange).toBe('transform')
    })

    it('enables will-change on a pan update via multi-drag', () => {
      render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')
      expect(container.style.willChange).toBe('')

      act(() => {
        getLatestMultiDragArgs().updateTransform(
          { x: 30, y: 40, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TouchSingleFingerPan,
            inputType: 'pointer',
            phase: 'change'
          }
        )
      })

      expect(container.style.willChange).toBe('transform')
    })

    it('keeps will-change active after endTransform until the debounce elapses', () => {
      render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
        getLatestWheelArgs().endTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'end'
          }
        )
      })

      expect(container.style.willChange).toBe('transform')
    })

    it('removes will-change after advancing fake timers through the debounce', () => {
      render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
        getLatestWheelArgs().endTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'end'
          }
        )
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        vi.advanceTimersByTime(199)
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(container.style.willChange).toBe('')
    })

    it('cancels pending removal and restarts debounce when a new update arrives before expiry', () => {
      render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
        getLatestWheelArgs().endTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'end'
          }
        )
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        vi.advanceTimersByTime(199)
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 20, y: 30, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
        getLatestWheelArgs().endTransform(
          { x: 20, y: 30, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'end'
          }
        )
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        vi.advanceTimersByTime(198)
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(container.style.willChange).toBe('')
    })

    it('does not enable will-change for disabled lazyWillChange values', () => {
      const { rerender } = render(
        <VirtualPaper lazyWillChange={0}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })
      expect(container.style.willChange).toBe('')

      rerender(
        <VirtualPaper lazyWillChange={-1}>
          <div>child</div>
        </VirtualPaper>
      )
      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })
      expect(container.style.willChange).toBe('')

      rerender(
        <VirtualPaper lazyWillChange={NaN}>
          <div>child</div>
        </VirtualPaper>
      )
      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })
      expect(container.style.willChange).toBe('')

      rerender(
        <VirtualPaper lazyWillChange={Infinity}>
          <div>child</div>
        </VirtualPaper>
      )
      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })
      expect(container.style.willChange).toBe('')
    })

    it('clears active will-change when lazyWillChange becomes disabled at runtime', () => {
      const { rerender } = render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })
      expect(container.style.willChange).toBe('transform')

      rerender(
        <VirtualPaper lazyWillChange={0}>
          <div>child</div>
        </VirtualPaper>
      )
      expect(container.style.willChange).toBe('')
    })

    it('preserves user containerStyle.willChange when lazy is inactive', () => {
      render(
        <VirtualPaper containerStyle={{ willChange: 'opacity' }}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')
      expect(container.style.willChange).toBe('opacity')
    })

    it('preserves user containerProps.style.willChange when lazy is inactive', () => {
      render(
        <VirtualPaper containerProps={{ style: { willChange: 'opacity' } }}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')
      expect(container.style.willChange).toBe('opacity')
    })

    it('overrides only willChange when lazy active while keeping other user styles', () => {
      render(
        <VirtualPaper
          lazyWillChange={200}
          containerStyle={{ color: 'red' }}
          containerProps={{
            style: {
              willChange: 'opacity',
              backgroundColor: 'blue'
            }
          }}
        >
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1.5 },
          {
            source: VirtualPaperInteractionMode.MouseWheelCtrlZoom,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })

      expect(container.style.willChange).toBe('transform')
      expect(container.style.color).toBe('red')
      expect(container.style.backgroundColor).toBe('blue')
      expect(container.style.transform).toBe(
        'translate3d(10px, 20px, 0) scale(1.5)'
      )
      expect(container.style.transformOrigin).toBe('0 0')
      expect(container.style.userSelect).toBe('text')
    })

    it('calls onTransformChange and onTransformChangeEnd immediately, not delayed by lazy debounce', () => {
      const onTransformChange = vi.fn()
      const onTransformChangeEnd = vi.fn()
      render(
        <VirtualPaper
          lazyWillChange={200}
          onTransformChange={onTransformChange}
          onTransformChangeEnd={onTransformChangeEnd}
        >
          <div>child</div>
        </VirtualPaper>
      )
      onTransformChange.mockClear()
      onTransformChangeEnd.mockClear()

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
      })
      expect(onTransformChange).toHaveBeenCalledTimes(1)
      expect(onTransformChange).toHaveBeenLastCalledWith(
        { x: 10, y: 20, scale: 1 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'change'
        }
      )

      act(() => {
        getLatestWheelArgs().endTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'end'
          }
        )
      })
      expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
      expect(onTransformChangeEnd).toHaveBeenLastCalledWith(
        { x: 10, y: 20, scale: 1 },
        {
          source: VirtualPaperInteractionMode.TrackpadScrollPan,
          inputType: 'wheel',
          phase: 'end'
        }
      )

      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(onTransformChange).toHaveBeenCalledTimes(1)
      expect(onTransformChangeEnd).toHaveBeenCalledTimes(1)
    })

    it('clears pending removal timer on unmount without state-update-after-unmount warnings', () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      const { unmount } = render(
        <VirtualPaper lazyWillChange={200}>
          <div>child</div>
        </VirtualPaper>
      )
      const container = screen.getByTestId('virtual-paper-container')

      act(() => {
        getLatestWheelArgs().updateTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'change'
          }
        )
        getLatestWheelArgs().endTransform(
          { x: 10, y: 20, scale: 1 },
          {
            source: VirtualPaperInteractionMode.TrackpadScrollPan,
            inputType: 'wheel',
            phase: 'end'
          }
        )
      })
      expect(container.style.willChange).toBe('transform')

      act(() => {
        vi.advanceTimersByTime(100)
      })

      unmount()

      act(() => {
        vi.advanceTimersByTime(300)
      })

      const unmountedWarnings = consoleErrorSpy.mock.calls.filter(
        ([message]) =>
          typeof message === 'string' &&
          /unmounted|state update/i.test(message)
      )
      expect(unmountedWarnings).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)

      consoleErrorSpy.mockRestore()
    })
  })
})
