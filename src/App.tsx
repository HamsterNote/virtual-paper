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
          {...(isControlled ? { transform: controlledTransform } : {})}
          onTransformChange={handleTransformChange}
        >
          <div
            style={{
              width: 600,
              height: 400,
              background: '#f0f0f0',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              padding: 20
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                style={{
                  background: '#3498db',
                  borderRadius: 8,
                  height: 80
                }}
              />
            ))}
          </div>
        </VirtualPaper>
      </main>
    </div>
  )
}
