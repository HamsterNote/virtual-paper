// allow: SIZE_OK — multi-drag gesture adapter state machine; splitting risks event-order regressions.
import { useEffect, useMemo, useRef } from 'react'
import {
  DragOperationType,
  Mixin,
  MixinType,
  type Finger,
  type Options,
  type Pose
} from '@system-ui-js/multi-drag'
import {
  applyElasticContainResistance,
  clampReaderTransform,
  clampScale,
  validateReaderModeZoomDebounceMs
} from './transform'
import {
  measureContainBox,
  projectContainTransformForElements
} from './containMode'
import { createElasticSettleController } from './elasticSettle'
import {
  type UseVirtualPaperInteractionArgs,
  type VirtualPaperInteractionMode as VirtualPaperInteractionModeType,
  type VirtualPaperTransform,
  READER_MODE_NATIVE_TOUCH_ACTION,
  VirtualPaperInteractionMode
} from './types'

type PointerModeFlags = {
  mouseDragPan: boolean
  touchSingleFingerPan: boolean
  touchTwoFingerPan: boolean
  touchTwoFingerZoom: boolean
  penPan: boolean
}

type ActivePointerGesture = {
  panSource?: VirtualPaperInteractionModeType
  zoomSource?: VirtualPaperInteractionModeType
}

const SCALE_EPSILON = 0.000001

const READER_MODE_PAN_SOURCES = [
  VirtualPaperInteractionMode.MouseDragPan,
  VirtualPaperInteractionMode.TouchSingleFingerPan,
  VirtualPaperInteractionMode.TouchTwoFingerPan,
  VirtualPaperInteractionMode.PenPan
]

const getPointerModeFlags = (
  enabledInteractions: VirtualPaperInteractionModeType[]
): PointerModeFlags => ({
  mouseDragPan: enabledInteractions.includes(
    VirtualPaperInteractionMode.MouseDragPan
  ),
  touchSingleFingerPan: enabledInteractions.includes(
    VirtualPaperInteractionMode.TouchSingleFingerPan
  ),
  touchTwoFingerPan: enabledInteractions.includes(
    VirtualPaperInteractionMode.TouchTwoFingerPan
  ),
  touchTwoFingerZoom: enabledInteractions.includes(
    VirtualPaperInteractionMode.TouchTwoFingerZoom
  ),
  penPan: enabledInteractions.includes(VirtualPaperInteractionMode.PenPan)
})

const hasPointerModes = (flags: PointerModeFlags): boolean => {
  return (
    flags.mouseDragPan ||
    flags.touchSingleFingerPan ||
    flags.touchTwoFingerPan ||
    flags.touchTwoFingerZoom ||
    flags.penPan
  )
}

const getFingerEvent = (finger: Finger): PointerEvent | undefined => {
  return finger.getLastOperation()?.event
}

const isPointerEvent = (
  event: PointerEvent | undefined
): event is PointerEvent => {
  return event !== undefined
}

const getActivePointerGesture = (
  fingers: Finger[],
  flags: PointerModeFlags
): ActivePointerGesture | null => {
  const events = fingers.map(getFingerEvent).filter(isPointerEvent)

  const hasPrimaryMouse = events.some((event) => {
    return event.pointerType === 'mouse' && event.isPrimary
  })
  if (hasPrimaryMouse) {
    return flags.mouseDragPan
      ? { panSource: VirtualPaperInteractionMode.MouseDragPan }
      : null
  }

  const hasPen = events.some((event) => event.pointerType === 'pen')
  if (hasPen) {
    return flags.penPan
      ? { panSource: VirtualPaperInteractionMode.PenPan }
      : null
  }

  const allTouch =
    fingers.length > 0 &&
    events.length === fingers.length &&
    events.every((event) => event.pointerType === 'touch')

  if (fingers.length === 1 && allTouch) {
    return flags.touchSingleFingerPan
      ? { panSource: VirtualPaperInteractionMode.TouchSingleFingerPan }
      : null
  }

  if (fingers.length >= 2 && allTouch) {
    const gesture: ActivePointerGesture = {}

    if (flags.touchTwoFingerPan) {
      gesture.panSource = VirtualPaperInteractionMode.TouchTwoFingerPan
    }
    if (flags.touchTwoFingerZoom) {
      gesture.zoomSource = VirtualPaperInteractionMode.TouchTwoFingerZoom
    }

    return gesture.panSource || gesture.zoomSource ? gesture : null
  }

  return null
}

const getMixinTypes = (flags: PointerModeFlags): MixinType[] => {
  const mixinTypes: MixinType[] = []

  if (
    flags.mouseDragPan ||
    flags.touchSingleFingerPan ||
    flags.touchTwoFingerPan ||
    flags.penPan
  ) {
    mixinTypes.push(MixinType.Drag)
  }

  if (flags.touchTwoFingerZoom) {
    mixinTypes.push(MixinType.Scale)
  }

  return mixinTypes
}

const getSingleFingerMixinTypes = (flags: PointerModeFlags): MixinType[] => {
  if (flags.mouseDragPan || flags.touchSingleFingerPan || flags.penPan) {
    return [MixinType.Drag]
  }

  return []
}

const chooseGestureSource = (
  activeGesture: ActivePointerGesture | null,
  currentScale: number,
  nextScale: number,
  didScaleDuringGesture: boolean
): VirtualPaperInteractionModeType | null => {
  if (!activeGesture) return null

  if (!activeGesture.panSource) {
    return activeGesture.zoomSource ?? null
  }

  if (!activeGesture.zoomSource) {
    return activeGesture.panSource
  }

  if (didScaleDuringGesture) {
    return activeGesture.zoomSource
  }

  return Math.abs(nextScale - currentScale) > SCALE_EPSILON
    ? activeGesture.zoomSource
    : activeGesture.panSource
}

const computeWrapperLocalMidpoint = (
  fingers: Finger[],
  wrapper: HTMLElement | null
): { x: number; y: number } | null => {
  if (!wrapper || fingers.length < 2) return null
  const rect = wrapper.getBoundingClientRect()
  let sumX = 0
  let sumY = 0
  let counted = 0
  for (const finger of fingers) {
    const point = finger.getLastOperation()?.point
    if (!point) return null
    sumX += point.x - rect.left
    sumY += point.y - rect.top
    counted += 1
  }
  return counted >= 2 ? { x: sumX / counted, y: sumY / counted } : null
}

export function useMultiDragInteractions(
  args: UseVirtualPaperInteractionArgs
): void {
  const {
    wrapperRef,
    containerRef,
    transform,
    enabledInteractions,
    minScale,
    maxScale,
    contentSize,
    updateTransform,
    endTransform,
    isReaderMode,
    containMode,
    edgeElasticScroll = false,
    incrementElasticActive,
    decrementElasticActive,
    readerModeZoomDebounceMs
  } = args

  const transformRef = useRef(transform)
  const minScaleRef = useRef(minScale)
  const maxScaleRef = useRef(maxScale)
  const contentSizeRef = useRef(contentSize)
  const updateTransformRef = useRef(updateTransform)
  const endTransformRef = useRef(endTransform)
  const isReaderModeRef = useRef(isReaderMode)
  const containModeRef = useRef(containMode)
  const edgeElasticScrollRef = useRef(edgeElasticScroll)
  const incrementElasticActiveRef = useRef(incrementElasticActive)
  const decrementElasticActiveRef = useRef(decrementElasticActive)
  const readerModeZoomDebounceMsRef = useRef(readerModeZoomDebounceMs)
  const readerZoomEndTimerRef = useRef<number | null>(null)
  const settleCancelRef = useRef<(() => void) | null>(null)
  const activeGestureRef = useRef<ActivePointerGesture | null>(null)
  // 保留最后一次非 null 的手势描述。
  // multi-drag 库的 finishPointer 流程中，finger.record(End) → finger.destroy()
  // → onDestroy → trigger(AllEnd) 会先于 setPose(End) → applyPose('end') 执行。
  // AllEnd 事件处理器会清空 activeGestureRef.current，导致 applyPose('end') 时
  // chooseGestureSource 返回 null 而提前退出——边缘弹性 settle 因此被跳过。
  // 此 ref 作为 fallback，在 phase==='end' 且 source 为 null 时提供最后一次有效的手势。
  const lastActiveGestureRef = useRef<ActivePointerGesture | null>(null)
  const zoomSegmentRef = useRef<{
    startTransform: VirtualPaperTransform
    startMid: { x: number; y: number }
  } | null>(null)
  // 标记当前手势期间是否真的发生过锚点缩放。
  // 用于在手指抬起（phase: 'end'）但锚点 midpoint 已不可算时，冻结位置
  // 而非套用控制器累积的孤儿位移（修复双指缩放 TouchEnd 跳变）。
  const didScaleDuringGestureRef = useRef(false)
  // 预防式屏蔽 flag：从双指缩放（multi）过渡到单指 pan（single）后，
  // 剩下那根手指的后续 move 不应再触发任何 pan 更新。
  // 否则控制器在 multi 期间独立累积的 pose.position 会被当成新位移叠加，造成跳变。
  // 参考 painting 的 singleTrackingDisabledUntilReset 机制（adapter 层预防）。
  // 在 multi→single 转换时置 true，在 AllEnd（所有手指抬起）时清空。
  const singlePanBlockedAfterMultiRef = useRef(false)

  transformRef.current = transform
  minScaleRef.current = minScale
  maxScaleRef.current = maxScale
  contentSizeRef.current = contentSize
  updateTransformRef.current = updateTransform
  endTransformRef.current = endTransform
  isReaderModeRef.current = isReaderMode
  containModeRef.current = containMode
  edgeElasticScrollRef.current = edgeElasticScroll
  incrementElasticActiveRef.current = incrementElasticActive
  decrementElasticActiveRef.current = decrementElasticActive
  readerModeZoomDebounceMsRef.current = readerModeZoomDebounceMs

  const flags = getPointerModeFlags(enabledInteractions)
  const {
    setElasticActive,
    cancelSettleAnimation,
    transformsMatch,
    settleElasticTransform
  } = useMemo(
    () =>
      createElasticSettleController({
        settleCancelRef,
        updateTransformRef,
        endTransformRef,
        incrementElasticActive: () => incrementElasticActiveRef.current?.(),
        decrementElasticActive: () => decrementElasticActiveRef.current?.()
      }),
    []
  )

  useEffect(() => {
    if (!containMode || !edgeElasticScroll || isReaderMode) {
      cancelSettleAnimation()
    }
  }, [containMode, edgeElasticScroll, isReaderMode, cancelSettleAnimation])

  useEffect(() => {
    const element = wrapperRef.current
    if (!element || !hasPointerModes(flags)) return

    let mixin: Mixin | null = null
    const touchActionBeforeMixin = element.style.touchAction

    const cancelReaderZoomEnd = () => {
      if (readerZoomEndTimerRef.current !== null) {
        window.clearTimeout(readerZoomEndTimerRef.current)
        readerZoomEndTimerRef.current = null
      }
    }

    const scheduleReaderZoomEnd = (
      transform: VirtualPaperTransform,
      meta: {
        source: VirtualPaperInteractionModeType
        inputType: 'pointer'
        phase: 'end'
      }
    ) => {
      cancelReaderZoomEnd()

      const debounceMs = validateReaderModeZoomDebounceMs(
        readerModeZoomDebounceMsRef.current
      )
      if (debounceMs === 0) {
        endTransformRef.current(transform, meta)
        return
      }

      readerZoomEndTimerRef.current = window.setTimeout(() => {
        endTransformRef.current(transform, meta)
        readerZoomEndTimerRef.current = null
      }, debounceMs)
    }

    const getPose = (target: HTMLElement): Pose => {
      const rect = target.getBoundingClientRect()
      const current = transformRef.current

      return {
        position: { x: current.x, y: current.y },
        width: rect.width,
        height: rect.height,
        scale: current.scale
      }
    }

    const applyPose = (
      target: HTMLElement,
      pose: Partial<Pose>,
      phase: 'change' | 'end'
    ) => {
      const currentPose = getPose(target)
      const currentTransform = transformRef.current
      const nextPosition = pose.position ?? currentPose.position
      const nextScale = clampScale(
        pose.scale ?? currentPose.scale ?? currentTransform.scale,
        minScaleRef.current,
        maxScaleRef.current
      )
      let source = chooseGestureSource(
        activeGestureRef.current,
        currentPose.scale ?? currentTransform.scale,
        nextScale,
        didScaleDuringGestureRef.current
      )

      // 库竞态 fallback：multi-drag 的 finishPointer 流程中，finger.destroy() →
      // trigger(AllEnd) 会先于 setPose(End) 执行，导致 activeGestureRef 已被
      // clearGestureState() 清空。end 阶段需要用 lastActiveGestureRef 兜底，
      // 否则边缘弹性 settle（snap-back）会被跳过。
      if (!source && phase === 'end' && lastActiveGestureRef.current) {
        source = chooseGestureSource(
          lastActiveGestureRef.current,
          currentPose.scale ?? currentTransform.scale,
          nextScale,
          didScaleDuringGestureRef.current
        )
      }

      if (!source) return

      if (isReaderModeRef.current && READER_MODE_PAN_SOURCES.includes(source)) {
        return
      }

      const segment = zoomSegmentRef.current
      const currentMid = computeWrapperLocalMidpoint(
        mixin?.getFingers() ?? [],
        wrapperRef.current
      )

      // 预防式屏蔽：multi→single 转换后，剩下那根手指的所有后续 pan 更新都直接丢弃。
      // 这覆盖了 didScaleDuringGestureRef freeze 漏掉的 phase==='change' 场景
      // （即"抬起一指后剩下手指继续 move"时的位移叠加跳变）。
      // phase==='end' 仍需继续走 applyPose 收尾，确保 TouchEnd 能完成回调语义。
      if (
        phase === 'change' &&
        source === VirtualPaperInteractionMode.TouchSingleFingerPan &&
        singlePanBlockedAfterMultiRef.current
      ) {
        return
      }

      if (
        phase === 'change' &&
        source === VirtualPaperInteractionMode.TouchTwoFingerZoom &&
        didScaleDuringGestureRef.current &&
        currentMid === null
      ) {
        return
      }

      const isAnchorZoom =
        source === VirtualPaperInteractionMode.TouchTwoFingerZoom &&
        segment !== null &&
        currentMid !== null

      let nextTransform: VirtualPaperTransform
      if (isAnchorZoom && segment && currentMid) {
        const startTransform = segment.startTransform
        const startMid = segment.startMid
        const contentX = (startMid.x - startTransform.x) / startTransform.scale
        const contentY = (startMid.y - startTransform.y) / startTransform.scale
        nextTransform = {
          x: currentMid.x - contentX * nextScale,
          y: currentMid.y - contentY * nextScale,
          scale: nextScale
        }
        didScaleDuringGestureRef.current = true
      } else if (phase === 'end' && didScaleDuringGestureRef.current) {
        // 缩放手势收尾，但此时手指已抬起导致锚点 midpoint 不可用。
        // 上一次 move 已应用了正确的锚点变换，这里冻结当前位置，避免把控制器
        // 在缩放期间独立累积、却从未被锚点分支使用过的 pose.position 当成新位移叠加
        // （即双指缩放 TouchEnd 跳变 bug）。
        nextTransform = { ...transformRef.current, scale: nextScale }
      } else {
        const deltaX = nextPosition.x - currentPose.position.x
        const deltaY = nextPosition.y - currentPose.position.y
        nextTransform = {
          x: currentTransform.x + deltaX,
          y: currentTransform.y + deltaY,
          scale: nextScale
        }
      }

      if (
        isReaderModeRef.current &&
        contentSizeRef.current &&
        wrapperRef.current
      ) {
        nextTransform = clampReaderTransform(
          nextTransform,
          contentSizeRef.current,
          wrapperRef.current.clientWidth,
          wrapperRef.current.clientHeight
        )
      }

      // contain 约束：非阅读模式下，将变换投影到 wrapper 内不露空白的合法范围
      let elasticTargetTransform: VirtualPaperTransform | null = null
      if (
        containModeRef.current &&
        !isReaderModeRef.current &&
        wrapperRef.current &&
        containerRef.current
      ) {
        if (edgeElasticScrollRef.current) {
          const box = measureContainBox(
            wrapperRef.current,
            containerRef.current,
            nextTransform.scale
          )
          if (box) {
            const elasticResult = applyElasticContainResistance({
              transform: nextTransform,
              containerSize: {
                width: box.containerWidth,
                height: box.containerHeight
              },
              wrapperSize: {
                width: box.wrapperWidth,
                height: box.wrapperHeight
              },
              enabled: true
            })
            elasticTargetTransform = elasticResult.targetTransform
            nextTransform = elasticResult.elasticTransform
            setElasticActive(
              !transformsMatch(
                elasticResult.elasticTransform,
                elasticResult.targetTransform
              )
            )
          } else {
            setElasticActive(false)
          }
        } else {
          setElasticActive(false)
          nextTransform = projectContainTransformForElements(
            nextTransform,
            wrapperRef.current,
            containerRef.current
          )
        }
      } else {
        setElasticActive(false)
      }

      const meta = {
        source,
        inputType: 'pointer' as const,
        phase
      }

      if (phase === 'end') {
        const endMeta = {
          source,
          inputType: 'pointer' as const,
          phase: 'end' as const
        }
        if (
          isReaderModeRef.current &&
          source === VirtualPaperInteractionMode.TouchTwoFingerZoom
        ) {
          scheduleReaderZoomEnd(nextTransform, endMeta)
          clearFinalEndFallback()
          return
        }

        if (
          elasticTargetTransform &&
          !transformsMatch(nextTransform, elasticTargetTransform)
        ) {
          settleElasticTransform(nextTransform, elasticTargetTransform, endMeta)
          clearFinalEndFallback()
          return
        }

        setElasticActive(false)
        const emittedTransform = elasticTargetTransform ?? nextTransform
        transformRef.current = emittedTransform
        endTransformRef.current(emittedTransform, endMeta)
        clearFinalEndFallback()
        return
      }

      if (
        !elasticTargetTransform ||
        transformsMatch(nextTransform, elasticTargetTransform)
      ) {
        setElasticActive(false)
      }
      transformRef.current = nextTransform
      updateTransformRef.current(nextTransform, meta)
    }

    const options: Options = {
      getPose,
      setPose: (target, pose) => applyPose(target, pose, 'change'),
      setPoseOnEnd: (target, pose) => applyPose(target, pose, 'end'),
      maxFingerCount: -1,
      inertial: false,
      passive: false
    }

    const trackGesture = (fingers: Finger[]) => {
      const previousGesture = activeGestureRef.current
      const nextGesture = getActivePointerGesture(fingers, flags)

      // 检测 multi→single 转换：
      //   之前 activeGestureRef.zoomSource 存在（处于双指缩放）
      //   现在 fingers.length === 1 且 nextGesture 解析为单指 pan
      // 此刻置 flag，让 applyPose 后续屏蔽剩下手指的 move（避免位移叠加跳变）。
      // 注意：本回调由 'end' / 'move' 事件触发，在 setPoseOnEnd / setPose 之后执行，
      //       所以对"当前这一帧"的 setPoseOnEnd 无影响（那一帧仍走 didScaleDuringGestureRef freeze），
      //       但对"下一帧"剩下的手指 move 生效。
      const wasMultiZoom = !!previousGesture?.zoomSource
      const isNowSingleTouchPan =
        fingers.length === 1 &&
        nextGesture?.panSource ===
          VirtualPaperInteractionMode.TouchSingleFingerPan
      if (wasMultiZoom && isNowSingleTouchPan) {
        singlePanBlockedAfterMultiRef.current = true
      }

      activeGestureRef.current = nextGesture

      // 库竞态保活：仅在手势仍有效时更新 lastActiveGestureRef。
      // AllEnd 会清空 activeGestureRef 但不会清空这里——这样 applyPose('end')
      // 在 AllEnd 之后被 setPose(End) 调用时仍能拿到最近一次有效手势。
      if (nextGesture) {
        lastActiveGestureRef.current = nextGesture
      }
    }
    const captureZoomSegment = (fingers: Finger[]) => {
      if (!activeGestureRef.current?.zoomSource) {
        zoomSegmentRef.current = null
        return
      }
      const mid = computeWrapperLocalMidpoint(fingers, wrapperRef.current)
      if (!mid) {
        zoomSegmentRef.current = null
        return
      }
      zoomSegmentRef.current = {
        startTransform: { ...transformRef.current },
        startMid: mid
      }
    }
    const clearGestureState = (keepScaleEndState = false) => {
      activeGestureRef.current = null
      zoomSegmentRef.current = null
      if (!keepScaleEndState) {
        didScaleDuringGestureRef.current = false
      }
      singlePanBlockedAfterMultiRef.current = false
    }
    const clearGesture = () => {
      clearGestureState(true)
      cancelReaderZoomEnd()
    }
    const clearFinalEndFallback = () => {
      if ((mixin?.getFingers() ?? []).length > 0) return

      didScaleDuringGestureRef.current = false
      lastActiveGestureRef.current = null
    }
    mixin = new Mixin(
      element,
      options,
      getMixinTypes(flags),
      getSingleFingerMixinTypes(flags)
    )

    // 当 MouseDragPan 未启用时，在 container 上拦截鼠标 pointerdown 的冒泡，
    // 阻止 Mixin 为鼠标创建 Finger。这样：
    // 1. 鼠标 text-selection 不会被 Mixin 的 pointermove 跟踪干扰（消除闪烁）
    // 2. 原生文字选择从点击位置开始而非从首字开始（消除选择锚点错乱）
    // Touch 和 Pen 事件不受影响，仍正常冒泡到 wrapper 上的 Mixin。
    const containerEl = containerRef.current
    const blockMousePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        event.stopPropagation()
      }
    }
    if (!flags.mouseDragPan && containerEl) {
      containerEl.addEventListener('pointerdown', blockMousePointerDown)
    }

    if (isReaderMode) {
      element.style.touchAction =
        touchActionBeforeMixin && touchActionBeforeMixin !== 'none'
          ? touchActionBeforeMixin
          : READER_MODE_NATIVE_TOUCH_ACTION
    }

    mixin.addEventListener(DragOperationType.Start, (fingers) => {
      cancelSettleAnimation()
      didScaleDuringGestureRef.current = false
      // 新手势开始：丢弃上一轮的 fallback 手势，避免跨手势误用。
      lastActiveGestureRef.current = null
      trackGesture(fingers)
      captureZoomSegment(fingers)
    })
    mixin.addEventListener(DragOperationType.Move, trackGesture)
    mixin.addEventListener(DragOperationType.End, (fingers) => {
      trackGesture(fingers)
      captureZoomSegment(fingers)
    })
    mixin.addEventListener(DragOperationType.AllEnd, clearGesture)

    return () => {
      activeGestureRef.current = null
      lastActiveGestureRef.current = null
      zoomSegmentRef.current = null
      didScaleDuringGestureRef.current = false
      singlePanBlockedAfterMultiRef.current = false
      cancelSettleAnimation()
      cancelReaderZoomEnd()
      mixin?.destroy()
      if (containerEl && !flags.mouseDragPan) {
        containerEl.removeEventListener('pointerdown', blockMousePointerDown)
      }
      if (isReaderMode) {
        element.style.touchAction = touchActionBeforeMixin
      }
    }
  }, [
    containerRef,
    wrapperRef,
    isReaderMode,
    flags.mouseDragPan,
    flags.touchSingleFingerPan,
    flags.touchTwoFingerPan,
    flags.touchTwoFingerZoom,
    flags.penPan,
    edgeElasticScroll,
    setElasticActive,
    cancelSettleAnimation,
    transformsMatch,
    settleElasticTransform
  ])
}
