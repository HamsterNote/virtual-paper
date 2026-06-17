import { Drag, DragOperationType, type Finger } from '@system-ui-js/multi-drag'
import { useEffect, useRef, useState } from 'react'

interface CardModel {
  id: string
  title: string
  detail: string
  color: string
  left: number
  top: number
}

interface DragStatus {
  cardTitle: string
  phase: DragOperationType | 'ready'
  fingerCount: number
  lastPoint: string
}

const cards: CardModel[] = [
  {
    id: 'quick-note',
    title: '单指拖动',
    detail: '按住便签任意位置移动。',
    color: '#f6b26b',
    left: 42,
    top: 44
  },
  {
    id: 'multi-touch',
    title: '多指捕获',
    detail: '触屏上可同时记录多个 pointer。',
    color: '#a6cbd9',
    left: 288,
    top: 134
  },
  {
    id: 'inertia',
    title: '惯性余韵',
    detail: '快速甩动后观察尾随运动。',
    color: '#d8c177',
    left: 142,
    top: 300
  }
]

const getLastPoint = (fingers: Finger[]) => {
  const lastFinger = fingers.at(-1)
  const lastOperation = lastFinger?.getLastOperation()

  if (!lastOperation) {
    return '等待触摸或鼠标按下'
  }

  return `${Math.round(lastOperation.point.x)}, ${Math.round(lastOperation.point.y)}`
}

export default function App() {
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [status, setStatus] = useState<DragStatus>({
    cardTitle: '拖动任意便签开始',
    phase: 'ready',
    fingerCount: 0,
    lastPoint: '等待触摸或鼠标按下'
  })

  useEffect(() => {
    const draggers = cards.flatMap((card) => {
      const element = cardRefs.current[card.id]

      if (!element) {
        return []
      }

      const dragger = new Drag(element, { inertial: true })
      const updateStatus =
        (phase: DragOperationType) => (fingers: Finger[]) => {
          setStatus({
            cardTitle: card.title,
            phase,
            fingerCount: fingers.length,
            lastPoint: getLastPoint(fingers)
          })
        }

      dragger.addEventListener(
        DragOperationType.Start,
        updateStatus(DragOperationType.Start)
      )
      dragger.addEventListener(
        DragOperationType.Move,
        updateStatus(DragOperationType.Move)
      )
      dragger.addEventListener(
        DragOperationType.End,
        updateStatus(DragOperationType.End)
      )
      dragger.addEventListener(
        DragOperationType.Inertial,
        updateStatus(DragOperationType.Inertial)
      )
      dragger.addEventListener(DragOperationType.AllEnd, () => {
        setStatus((current) => ({
          ...current,
          phase: DragOperationType.AllEnd,
          fingerCount: 0
        }))
      })

      return [dragger]
    })

    return () => {
      draggers.forEach((dragger) => {
        dragger.destroy()
      })
    }
  }, [])

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">@system-ui-js/multi-drag</p>
        <h1 id="page-title">指尖拖拽实验台</h1>
        <p className="lede">
          用手指或鼠标拖动卡片，观察 multi-drag
          手势事件如何驱动画布里的多个对象。
        </p>
      </section>

      <section className="demo-grid" aria-label="multi-drag 指拖动演示">
        <section className="stage" aria-label="可拖动区域">
          <div className="stage-ruler stage-ruler-one" />
          <div className="stage-ruler stage-ruler-two" />

          {cards.map((card) => (
            <button
              key={card.id}
              ref={(element) => {
                cardRefs.current[card.id] = element
              }}
              className="drag-card"
              style={{
                backgroundColor: card.color,
                left: card.left,
                top: card.top
              }}
              type="button"
              aria-label={`拖动 ${card.title}`}
            >
              <span>{card.title}</span>
              <small>{card.detail}</small>
            </button>
          ))}
        </section>

        <aside className="status-panel" aria-live="polite">
          <p className="panel-kicker">Gesture snapshot</p>
          <dl>
            <div>
              <dt>目标</dt>
              <dd>{status.cardTitle}</dd>
            </div>
            <div>
              <dt>阶段</dt>
              <dd>{status.phase}</dd>
            </div>
            <div>
              <dt>手指 / pointer 数</dt>
              <dd>{status.fingerCount}</dd>
            </div>
            <div>
              <dt>最后坐标</dt>
              <dd>{status.lastPoint}</dd>
            </div>
          </dl>
          <p className="hint">
            手机或平板访问同一局域网地址即可触摸测试；桌面浏览器可用鼠标模拟单指拖动。
          </p>
        </aside>
      </section>
    </main>
  )
}
