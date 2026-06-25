import type { MutableRefObject } from 'react'

import { createEaseAnimation } from './animation'
import type {
  VirtualPaperTransform,
  VirtualPaperTransformMeta,
  VirtualPaperTransformUpdater
} from './types'

type ElasticSettleEndMeta = Omit<VirtualPaperTransformMeta, 'phase'> & {
  readonly phase: 'end'
}

type ElasticSettleControllerRefs = {
  readonly settleCancelRef: MutableRefObject<(() => void) | null>
  readonly updateTransformRef: MutableRefObject<VirtualPaperTransformUpdater>
  readonly endTransformRef: MutableRefObject<VirtualPaperTransformUpdater>
  readonly incrementElasticActive: () => void
  readonly decrementElasticActive: () => void
  readonly emitInitialUpdate?: boolean
}

export type ElasticSettleController = {
  readonly setElasticActive: (active: boolean) => void
  readonly cancelSettleAnimation: () => void
  readonly transformsMatch: (
    first: VirtualPaperTransform,
    second: VirtualPaperTransform
  ) => boolean
  readonly settleElasticTransform: (
    from: VirtualPaperTransform,
    to: VirtualPaperTransform,
    endMeta: ElasticSettleEndMeta
  ) => void
}

export const createElasticSettleController = ({
  settleCancelRef,
  updateTransformRef,
  endTransformRef,
  incrementElasticActive,
  decrementElasticActive,
  emitInitialUpdate = true
}: ElasticSettleControllerRefs): ElasticSettleController => {
  // 跟踪当前 controller 是否处于弹性活跃状态，确保 increment/decrement 成对出现，
  // 避免多个 controller 共享同一个全局计数器时出现重复计数或漏减。
  let isElasticActive = false

  const markElasticActive = (active: boolean) => {
    if (active === isElasticActive) return
    isElasticActive = active
    if (active) {
      incrementElasticActive()
    } else {
      decrementElasticActive()
    }
  }

  const cancelSettleAnimation = () => {
    settleCancelRef.current?.()
    settleCancelRef.current = null
    markElasticActive(false)
  }

  const transformsMatch = (
    first: VirtualPaperTransform,
    second: VirtualPaperTransform
  ): boolean => {
    return (
      first.x === second.x &&
      first.y === second.y &&
      first.scale === second.scale
    )
  }

  const settleElasticTransform = (
    from: VirtualPaperTransform,
    to: VirtualPaperTransform,
    endMeta: ElasticSettleEndMeta
  ) => {
    cancelSettleAnimation()

    if (transformsMatch(from, to)) {
      endTransformRef.current(to, endMeta)
      return
    }

    const changeMeta = { ...endMeta, phase: 'change' as const }
    markElasticActive(true)
    if (emitInitialUpdate) {
      updateTransformRef.current(from, changeMeta)
    }
    settleCancelRef.current = createEaseAnimation({
      from,
      to,
      onUpdate(next) {
        updateTransformRef.current(next, changeMeta)
      },
      onComplete() {
        settleCancelRef.current = null
        markElasticActive(false)
        endTransformRef.current(to, endMeta)
      }
    })
  }

  return {
    setElasticActive: markElasticActive,
    cancelSettleAnimation,
    transformsMatch,
    settleElasticTransform
  }
}
