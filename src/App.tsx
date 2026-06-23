import { useCallback, useState } from 'react'
import {
  VirtualPaper,
  VirtualPaperInteractionMode,
  VirtualPaperInitialPlacement,
  DEFAULT_ENABLED_INTERACTIONS
} from './index'
import type { VirtualPaperTransform } from './index'

const ALL_MODES = Object.values(VirtualPaperInteractionMode)

export default function App() {
  const [enabledInteractions, setEnabledInteractions] = useState<
    VirtualPaperInteractionMode[]
  >(DEFAULT_ENABLED_INTERACTIONS)

  const [initialPlacement, setInitialPlacement] = useState(
    VirtualPaperInitialPlacement.Center
  )

  const [isControlled, setIsControlled] = useState(false)

  const [controlledTransform, setControlledTransform] =
    useState<VirtualPaperTransform>({ x: 0, y: 0, scale: 1 })

  const [readoutTransform, setReadoutTransform] =
    useState<VirtualPaperTransform>({ x: 0, y: 0, scale: 1 })

  const [remountKey, setRemountKey] = useState(0)

  const [readerMode, setReaderMode] = useState(false)

  const [containMode, setContainMode] = useState(false)

  const [inertialScroll, setInertialScroll] = useState(false)

  const [edgeElasticScroll, setEdgeElasticScroll] = useState(false)

  const [controlledX, setControlledX] = useState('0')
  const [controlledY, setControlledY] = useState('0')
  const [controlledScale, setControlledScale] = useState('1')

  const toggleMode = useCallback((mode: VirtualPaperInteractionMode) => {
    setEnabledInteractions((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    )
  }, [])

  const handlePlacementChange = useCallback(
    (placement: VirtualPaperInitialPlacement) => {
      setInitialPlacement(placement)
      setRemountKey((k) => k + 1)
    },
    []
  )

  const handleControlledToggle = useCallback(
    (checked: boolean) => {
      setIsControlled(checked)
      if (checked) {
        setControlledX(String(controlledTransform.x))
        setControlledY(String(controlledTransform.y))
        setControlledScale(String(controlledTransform.scale))
      }
    },
    [controlledTransform]
  )

  const applyControlledTransform = useCallback(() => {
    const x = parseFloat(controlledX) || 0
    const y = parseFloat(controlledY) || 0
    const scale = parseFloat(controlledScale) || 1
    setControlledTransform({ x, y, scale })
  }, [controlledX, controlledY, controlledScale])

  const handleReset = useCallback(() => {
    setRemountKey((k) => k + 1)
  }, [])

  const handleTransformChange = useCallback(
    (transform: VirtualPaperTransform) => {
      setReadoutTransform(transform)
    },
    []
  )

  return (
    <div className="demo-shell">
      <aside className="controls-panel">
        <h2>VirtualPaper 控制器</h2>

        <section className="control-section">
          <h3>交互模式</h3>
          {ALL_MODES.map((mode) => (
            <label key={mode} className="mode-toggle">
              <input
                type="checkbox"
                data-testid={`mode-toggle-${mode}`}
                checked={enabledInteractions.includes(mode)}
                onChange={() => toggleMode(mode)}
              />
              <span>{mode}</span>
            </label>
          ))}
        </section>

        <section className="control-section">
          <h3>初始位置</h3>
          <select
            data-testid="placement-select"
            value={initialPlacement}
            onChange={(e) =>
              handlePlacementChange(
                e.target.value as VirtualPaperInitialPlacement
              )
            }
          >
            <option value={VirtualPaperInitialPlacement.Center}>
              Center
            </option>
            <option value={VirtualPaperInitialPlacement.TopLeft}>
              TopLeft
            </option>
          </select>
        </section>

        <section className="control-section">
          <h3>阅读模式</h3>
          <label className="mode-toggle">
            <input
              type="checkbox"
              data-testid="reader-mode-toggle"
              checked={readerMode}
              onChange={(e) => {
                setReaderMode(e.target.checked)
                setRemountKey((k) => k + 1)
              }}
            />
            <span>启用阅读模式</span>
          </label>
        </section>

        <section className="control-section">
          <h3>Contain Mode</h3>
          <label className="mode-toggle">
            <input
              type="checkbox"
              data-testid="contain-mode-toggle"
              checked={containMode}
              onChange={(e) => {
                setContainMode(e.target.checked)
                setRemountKey((k) => k + 1)
              }}
            />
            <span>启用 contain mode</span>
          </label>
        </section>

        <section className="control-section">
          <h3>Inertial Scroll</h3>
          <label className="mode-toggle">
            <input
              type="checkbox"
              data-testid="inertial-scroll-toggle"
              checked={inertialScroll}
              onChange={(e) => {
                setInertialScroll(e.target.checked)
                setRemountKey((k) => k + 1)
              }}
            />
            <span>启用惯性滚动</span>
          </label>
        </section>

        <section className="control-section">
          <h3>Edge Elastic Scroll</h3>
          <label className="mode-toggle">
            <input
              type="checkbox"
              data-testid="edge-elastic-scroll-toggle"
              checked={edgeElasticScroll}
              onChange={(e) => {
                setEdgeElasticScroll(e.target.checked)
                setRemountKey((k) => k + 1)
              }}
            />
            <span>启用边缘弹性滚动</span>
          </label>
        </section>

        <section className="control-section">
          <h3>受控模式</h3>
          <label className="mode-toggle">
            <input
              type="checkbox"
              data-testid="controlled-toggle"
              checked={isControlled}
              onChange={(e) => handleControlledToggle(e.target.checked)}
            />
            <span>启用受控模式</span>
          </label>

          {isControlled && (
            <div className="controlled-inputs">
              <label>
                X
                <input
                  type="number"
                  data-testid="controlled-x-input"
                  value={controlledX}
                  onChange={(e) => setControlledX(e.target.value)}
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  data-testid="controlled-y-input"
                  value={controlledY}
                  onChange={(e) => setControlledY(e.target.value)}
                />
              </label>
              <label>
                Scale
                <input
                  type="number"
                  data-testid="controlled-scale-input"
                  step="0.1"
                  value={controlledScale}
                  onChange={(e) => setControlledScale(e.target.value)}
                />
              </label>
              <button
                data-testid="apply-controlled-transform"
                onClick={applyControlledTransform}
              >
                应用
              </button>
            </div>
          )}
        </section>

        <section className="control-section">
          <button data-testid="reset-transform" onClick={handleReset}>
            重置
          </button>
        </section>

        <section className="control-section">
          <h3>当前变换</h3>
          <div data-testid="transform-readout">
            x: {readoutTransform.x.toFixed(2)}, y:{' '}
            {readoutTransform.y.toFixed(2)}, scale:{' '}
            {readoutTransform.scale.toFixed(3)}
          </div>
        </section>
      </aside>

      <main className="paper-stage">
        <VirtualPaper
          key={remountKey}
          enabledInteractions={enabledInteractions}
          initialPlacement={initialPlacement}
          containerStyle={{ width: 600, height: 400 }}
          containMode={containMode}
          inertialScroll={inertialScroll}
          edgeElasticScroll={edgeElasticScroll}
          {...(isControlled ? { transform: controlledTransform } : {})}
          onTransformChange={handleTransformChange}
          {...(readerMode
            ? {
                readerMode: true,
                contentSize: { width: 600, height: 400 },
                readerModeZoomDebounceMs: 500
              }
            : {})}
        >
          <div
            style={{
              width: '100%',
              minHeight: '100%',
              background: '#f0f0f0',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}
          >
            <h2 style={{ margin: 0, color: '#2c3e50', fontSize: 22 }}>
              VirtualPaper Demo
            </h2>
            <p style={{ margin: 0, lineHeight: 1.7, color: '#34495e', fontSize: 15 }}>
              这是一段示例文字。当左侧控制面板中的 MouseDragPan 未勾选时，你可以用鼠标自由选中、复制这段文字。
              文字选择不会触发画布拖拽，选择范围从你点击的位置开始，而非从首个字符开始。
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  style={{
                    background: '#3498db',
                    borderRadius: 8,
                    height: 80,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14
                  }}
                >
                  Card {i}
                </div>
              ))}
            </div>
            <p style={{ margin: 0, lineHeight: 1.7, color: '#34495e', fontSize: 15 }}>
              另一段示例文字：支持 Ctrl+滚轮缩放、触控板滚动等交互。勾选 MouseDragPan 后，
              鼠标拖拽将用于平移画布，此时文字不可选中；取消勾选则恢复文字选择能力。
              你也可以尝试缩放后选中不同大小的文字。
            </p>
          </div>
        </VirtualPaper>
      </main>
    </div>
  )
}
