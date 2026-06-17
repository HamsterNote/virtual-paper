import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useRef, useState } from 'react'
import {
  DragOperationType,
  Mixin,
  MixinType,
  type Pose
} from '@system-ui-js/multi-drag'

import { useMultiDragInteractions } from './useMultiDragInteractions'
import {
  type VirtualPaperTransform,
  type VirtualPaperTransformUpdater,
  VirtualPaperInteractionMode
} from './types'

const {
  mockDestroy,
  mockAddEventListener,
  mockRemoveEventListener
} = vi.hoisted(() => ({
  mockDestroy: vi.fn(),
  mockAddEventListener: vi.fn(),
  mockRemoveEventListener: vi.fn()
}))

vi.mock('@system-ui-js/multi-drag', () => ({
  Mixin: vi.fn().mockImplementation(function () {
    return {
      destroy: mockDestroy,
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener
    }
  }),
  MixinType: {
    Drag: 'drag',
    Scale: 'scale'
  },
  DragOperationType: {
    Start: 'start',
    Move: 'move',
    End: 'end',
    AllEnd: 'allend'
  }
}))

type MultiDragHarnessProps = {
  enabledInteractions: VirtualPaperInteractionMode[]
  initialTransform?: VirtualPaperTransform
  minScale?: number
  maxScale?: number
  onUpdate?: VirtualPaperTransformUpdater
  onEnd?: VirtualPaperTransformUpdater
}

type MockFinger = {
  getLastOperation: () => { event: PointerEvent }
}

type MultiDragListener = (fingers: MockFinger[]) => void

type MultiDragOptions = {
  getPose: (target: HTMLElement) => Pose
  setPose: (target: HTMLElement, pose: Partial<Pose>) => void
  setPoseOnEnd: (target: HTMLElement, pose: Partial<Pose>) => void
}

type MixinConstructorCall = [
  HTMLElement,
  MultiDragOptions,
  unknown[],
  unknown[]
]

const defaultTransform = { x: 10, y: 20, scale: 1 }

function MultiDragHarness({
  enabledInteractions,
  initialTransform = defaultTransform,
  minScale = 0.25,
  maxScale = 4,
  onUpdate = () => undefined,
  onEnd = () => undefined
}: MultiDragHarnessProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [transform, setTransform] = useState(initialTransform)

  useMultiDragInteractions({
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
    <div ref={wrapperRef} data-testid="multi-wrapper">
      <div
        ref={containerRef}
        data-testid="multi-container"
        data-x={transform.x}
        data-y={transform.y}
        data-scale={transform.scale}
      />
    </div>
  )
}

const createRect = (): DOMRect => ({
  width: 800,
  height: 600,
  top: 0,
  left: 0,
  right: 800,
  bottom: 600,
  x: 0,
  y: 0,
  toJSON() {
    return this
  }
}) as unknown as DOMRect

const createFinger = (
  pointerType: 'mouse' | 'pen' | 'touch',
  isPrimary = true
): MockFinger => ({
  getLastOperation: () => ({
    event: { pointerType, isPrimary } as PointerEvent
  })
})

const getMixinCall = (index = 0): MixinConstructorCall => {
  return vi.mocked(Mixin).mock.calls[index] as unknown as MixinConstructorCall
}

const getMixinOptions = (index = 0): MultiDragOptions => getMixinCall(index)[1]

const getMixinTypes = (index = 0): unknown[] => getMixinCall(index)[2]

const getRegisteredListener = (type: string): MultiDragListener => {
  const listenerCall = mockAddEventListener.mock.calls.find(([eventType]) => {
    return eventType === type
  })

  expect(listenerCall).toBeDefined()

  return listenerCall?.[1] as MultiDragListener
}

const startGesture = (fingers: MockFinger[]) => {
  act(() => {
    getRegisteredListener(DragOperationType.Start)(fingers)
  })
}

describe('useMultiDragInteractions', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.getBoundingClientRect = function () {
      if (
        this.getAttribute('data-testid') === 'multi-wrapper' ||
        this.getAttribute('data-testid') === 'multi-container'
      ) {
        return createRect()
      }

      return originalGetBoundingClientRect.call(this)
    }
  })

  afterEach(() => {
    cleanup()
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  })

  it('cleans up one active Mixin per StrictMode mount', () => {
    const { unmount } = render(
      <StrictMode>
        <MultiDragHarness
          enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
        />
      </StrictMode>
    )

    const activeMixinCount = vi.mocked(Mixin).mock.calls.length

    expect(activeMixinCount).toBeGreaterThan(0)

    act(() => {
      unmount()
    })

    expect(mockDestroy).toHaveBeenCalledTimes(activeMixinCount)
  })

  it('does not instantiate Mixin when no pointer modes are enabled', () => {
    render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.TrackpadScrollPan]}
      />
    )

    expect(Mixin).not.toHaveBeenCalled()
  })

  it('instantiates Mixin with Drag type when MouseDragPan is enabled', () => {
    render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
      />
    )

    expect(getMixinTypes()).toContain(MixinType.Drag)
  })

  it('instantiates Mixin with Scale type when TouchTwoFingerZoom is enabled', () => {
    render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.TouchTwoFingerZoom]}
      />
    )

    expect(getMixinTypes()).toContain(MixinType.Scale)
  })

  it('routes MouseDragPan updates to the mouse source', () => {
    const onUpdate = vi.fn()

    render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
        onUpdate={onUpdate}
      />
    )

    startGesture([createFinger('mouse')])

    act(() => {
      getMixinOptions().setPose(screen.getByTestId('multi-container'), {
        position: { x: 40, y: 55 }
      })
    })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: 40, y: 55, scale: 1 },
      {
        source: VirtualPaperInteractionMode.MouseDragPan,
        inputType: 'pointer',
        phase: 'change'
      }
    )
  })

  it('routes PenPan updates to the pen source', () => {
    const onUpdate = vi.fn()

    render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.PenPan]}
        onUpdate={onUpdate}
      />
    )

    startGesture([createFinger('pen')])

    act(() => {
      getMixinOptions().setPose(screen.getByTestId('multi-container'), {
        position: { x: 15, y: 30 }
      })
    })

    expect(onUpdate).toHaveBeenCalledWith(
      { x: 15, y: 30, scale: 1 },
      {
        source: VirtualPaperInteractionMode.PenPan,
        inputType: 'pointer',
        phase: 'change'
      }
    )
  })

  it('ignores touch single-finger pan unless that mode is enabled', () => {
    const onUpdate = vi.fn()

    render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
        onUpdate={onUpdate}
      />
    )

    startGesture([createFinger('touch')])

    act(() => {
      getMixinOptions().setPose(screen.getByTestId('multi-container'), {
        position: { x: 40, y: 55 }
      })
    })

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('supports touch two-finger pan and zoom routing when both modes are enabled', () => {
    const onUpdate = vi.fn()

    render(
      <MultiDragHarness
        enabledInteractions={[
          VirtualPaperInteractionMode.TouchTwoFingerPan,
          VirtualPaperInteractionMode.TouchTwoFingerZoom
        ]}
        onUpdate={onUpdate}
      />
    )

    expect(getMixinTypes()).toEqual([MixinType.Drag, MixinType.Scale])

    startGesture([createFinger('touch'), createFinger('touch', false)])

    act(() => {
      getMixinOptions().setPose(screen.getByTestId('multi-container'), {
        position: { x: 30, y: 45 }
      })
    })

    expect(onUpdate).toHaveBeenLastCalledWith(
      { x: 30, y: 45, scale: 1 },
      {
        source: VirtualPaperInteractionMode.TouchTwoFingerPan,
        inputType: 'pointer',
        phase: 'change'
      }
    )

    act(() => {
      getMixinOptions().setPose(screen.getByTestId('multi-container'), {
        position: { x: 35, y: 50 },
        scale: 2
      })
    })

    expect(onUpdate).toHaveBeenLastCalledWith(
      { x: 35, y: 50, scale: 2 },
      {
        source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
        inputType: 'pointer',
        phase: 'change'
      }
    )
  })

  it('destroys Mixin on unmount after registering gesture listeners', () => {
    const { unmount } = render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
      />
    )

    expect(mockAddEventListener).toHaveBeenCalledWith(
      DragOperationType.Start,
      expect.any(Function)
    )
    expect(mockAddEventListener).toHaveBeenCalledWith(
      DragOperationType.Move,
      expect.any(Function)
    )
    expect(mockAddEventListener).toHaveBeenCalledWith(
      DragOperationType.AllEnd,
      expect.any(Function)
    )

    act(() => {
      unmount()
    })

    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('returns current transform and target dimensions from getPose', () => {
    render(
      <MultiDragHarness
        enabledInteractions={[VirtualPaperInteractionMode.MouseDragPan]}
        initialTransform={{ x: 50, y: 75, scale: 1.5 }}
      />
    )

    expect(getMixinOptions().getPose(screen.getByTestId('multi-container'))).toEqual({
      position: { x: 50, y: 75 },
      width: 800,
      height: 600,
      scale: 1.5
    })
  })
})
