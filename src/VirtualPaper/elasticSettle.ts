import type { MutableRefObject } from 'react'

import { createSpringAnimation } from './animation'
import type { VirtualPaperTransform, VirtualPaperTransformMeta, VirtualPaperTransformUpdater } from './types'

type ElasticSettleEndMeta = Omit<VirtualPaperTransformMeta, 'phase'> & {
  readonly phase: 'end'
}

type ElasticSettleControllerRefs = {
  readonly elasticActiveRefRef: MutableRefObject<MutableRefObject<boolean> | undefined>
  readonly settleCancelRef: MutableRefObject<(() => void) | null>
  readonly updateTransformRef: MutableRefObject<VirtualPaperTransformUpdater>
  readonly endTransformRef: MutableRefObject<VirtualPaperTransformUpdater>
  readonly emitInitialUpdate?: boolean
}

export type ElasticSettleController = {
  readonly setElasticActive: (active: boolean) => void
  readonly cancelSettleAnimation: () => void
  readonly transformsMatch: (first: VirtualPaperTransform, second: VirtualPaperTransform) => boolean
  readonly settleElasticTransform: (
    from: VirtualPaperTransform,
    to: VirtualPaperTransform,
    endMeta: ElasticSettleEndMeta
  ) => void
}

export const createElasticSettleController = ({
  elasticActiveRefRef,
  settleCancelRef,
  updateTransformRef,
  endTransformRef,
  emitInitialUpdate = true
}: ElasticSettleControllerRefs): ElasticSettleController => {
  const setElasticActive = (active: boolean) => {
    const activeRef = elasticActiveRefRef.current
    if (activeRef) {
      activeRef.current = active
    }
  }

  const cancelSettleAnimation = () => {
    settleCancelRef.current?.()
    settleCancelRef.current = null
    setElasticActive(false)
  }

  const transformsMatch = (
    first: VirtualPaperTransform,
    second: VirtualPaperTransform
  ): boolean => {
    return first.x === second.x && first.y === second.y && first.scale === second.scale
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
    setElasticActive(true)
    if (emitInitialUpdate) {
      updateTransformRef.current(from, changeMeta)
    }
    settleCancelRef.current = createSpringAnimation({
      from,
      to,
      onUpdate(next) {
        updateTransformRef.current(next, changeMeta)
      },
      onComplete() {
        settleCancelRef.current = null
        setElasticActive(false)
        endTransformRef.current(to, endMeta)
      }
    })
  }

  return {
    setElasticActive,
    cancelSettleAnimation,
    transformsMatch,
    settleElasticTransform
  }
}
