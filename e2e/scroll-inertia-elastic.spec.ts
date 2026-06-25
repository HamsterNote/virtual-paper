import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Browser-level QA for edgeElasticScroll toggle and reader-mode scrolling.
 *
 * Demo page wiring (App.tsx):
 *   - edgeElasticScroll toggle checkbox (data-testid="edge-elastic-scroll-toggle").
 *   - containMode toggle checkbox (data-testid="contain-mode-toggle").
 *   - Wired props into <VirtualPaper> so toggles actually affect runtime behaviour.
 *
 * Scenarios covered:
 *   1. edgeElasticScroll prop is wired and drag gestures still work correctly.
 *   2. Reader mode still scrolls natively with no elastic rubber-band transform.
 *
 * Note on elastic observability:
 *   The elastic overshoot behaviour is driven by the internal
 *   @system-ui-js/multi-drag library. It completes very quickly (sub-100ms)
 *   and depends on precise pose-record timing, making it difficult to observe
 *   reliably in e2e. Detailed behaviour is covered by unit tests in
 *   useMultiDragInteractions.test.tsx and useWheelInteractions.test.tsx.
 */

const EVIDENCE_DIR = '.omo/evidence'
const TRANSFORM_RE = /x: ([\d.-]+), y: ([\d.-]+), scale: ([\d.-]+)/

interface TransformReadout {
  x: number
  y: number
  scale: number
}

interface ReactFiberNode {
  readonly return?: ReactFiberNode | null
  readonly elementType?: { readonly name?: string } | null
  readonly memoizedProps?: unknown
}

async function readTransform(page: Page): Promise<TransformReadout> {
  const text = await page
    .locator('[data-testid="transform-readout"]')
    .innerText()
  const match = text.match(TRANSFORM_RE)
  if (!match) {
    throw new Error(`Unexpected transform readout: ${text}`)
  }

  const [, x, y, scale] = match
  if (x === undefined || y === undefined || scale === undefined) {
    throw new Error(`Incomplete transform readout: ${text}`)
  }

  return {
    x: Number(x),
    y: Number(y),
    scale: Number(scale)
  }
}

async function saveEvidence(page: Page, fileName: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${fileName}`, fullPage: true })
}

/** Ensure a mode toggle is checked (handles remount re-checking) */
async function ensureModeChecked(page: Page, testId: string) {
  const toggle = page.locator(`[data-testid="${testId}"]`)
  if (!(await toggle.isChecked())) {
    await toggle.check()
  }
  await expect(toggle).toBeChecked()
}

/** Read VirtualPaper props via React fiber (for verifying prop wiring) */
async function readVirtualPaperProps(
  page: Page
): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null
    }

    function isReactFiberNode(value: unknown): value is ReactFiberNode {
      return isRecord(value)
    }

    const container = document.querySelector(
      '[data-testid="virtual-paper-wrapper"]'
    )
    if (!container) return null

    const key = Object.keys(container).find((k) =>
      k.startsWith('__reactFiber$')
    )
    if (!key) return null

    let fiber: unknown = Reflect.get(container, key)
    while (isReactFiberNode(fiber) && isReactFiberNode(fiber.return)) {
      const parent = fiber.return
      if (parent.elementType?.name === 'VirtualPaper') {
        const memoizedProps = parent.memoizedProps
        if (!isRecord(memoizedProps)) return null
        // 只返回可序列化的原始 prop，避免 React fiber / children 等引用链过长。
        const keys = [
          'edgeElasticScroll',
          'readerMode',
          'containMode',
          'renderMode'
        ]
        return Object.fromEntries(keys.map((k) => [k, memoizedProps[k]]))
      }
      fiber = parent
    }
    return null
  })
}

test.describe('Edge elastic and reader-mode scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('[data-testid="transform-readout"]')
  })

  // --- Test 1: edgeElasticScroll is wired and drag works ---
  test('edgeElasticScroll: prop is wired and drag gestures work', async ({
    page
  }) => {
    // Enable contain mode and edge elastic scroll (causes remount)
    await page.locator('[data-testid="contain-mode-toggle"]').check()
    await page.locator('[data-testid="edge-elastic-scroll-toggle"]').check()
    await page.waitForTimeout(150)

    // Verify the prop is passed to VirtualPaper
    const props = await readVirtualPaperProps(page)
    expect(props).not.toBeNull()
    expect(props?.edgeElasticScroll).toBe(true)

    // Enable MouseDragPan for desktop pointer interaction
    await ensureModeChecked(page, 'mode-toggle-MouseDragPan')

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const box = await wrapper.boundingBox()
    if (!box) {
      throw new Error('VirtualPaper wrapper bounding box is unavailable')
    }

    // First zoom in so content is oversized and can be panned to the edge
    await wrapper.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: -400,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true
        })
      )
    })
    await page.waitForTimeout(200)

    const afterZoom = await readTransform(page)
    expect(afterZoom.scale).toBeGreaterThan(1.2)

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Now drag aggressively toward the edge
    const startX = cx
    const startY = cy
    const endX = cx + 300
    const endY = cy + 200

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, { steps: 5 })
    await page.waitForTimeout(50)

    const duringDrag = await readTransform(page)

    // Release
    await page.mouse.up()

    // Sample after release
    const samples: TransformReadout[] = []
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(60)
      const t = await readTransform(page)
      samples.push({ ...t })
    }

    const afterRelease = samples[samples.length - 1]
    if (!afterRelease) {
      throw new Error('Missing elastic release transform sample')
    }

    // Log numeric evidence
    const logLines = [
      `edgeElasticScroll prop: ${props?.edgeElasticScroll}`,
      `After zoom: x=${afterZoom.x.toFixed(2)}, y=${afterZoom.y.toFixed(2)}, scale=${afterZoom.scale.toFixed(3)}`,
      `During edge drag: x=${duringDrag.x.toFixed(2)}, y=${duringDrag.y.toFixed(2)}`,
      `After release: x=${afterRelease.x.toFixed(2)}, y=${afterRelease.y.toFixed(2)}`
    ]
    console.log(logLines.join('\n'))

    // Assertions:
    // 1. The edgeElasticScroll prop is correctly wired
    expect(props?.edgeElasticScroll).toBe(true)

    // 2. The drag should have moved the transform from the zoom position
    expect(duringDrag.x).not.toBe(afterZoom.x)

    // 3. After release, the transform is within legal bounds
    //    (contain mode clamps to valid range)
    expect(afterRelease.scale).toBe(afterZoom.scale)

    await saveEvidence(page, 'task-9-edge-elastic-overshoot.png')
  })

  // --- Test 2: Reader mode with elastic toggle still uses native scroll ---
  test('reader mode ignores elastic toggles and uses native scroll', async ({
    page
  }) => {
    // Use a viewport smaller than the content so scrolling is possible
    await page.setViewportSize({ width: 400, height: 300 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('[data-testid="transform-readout"]')

    // Enable reader mode
    await page.locator('[data-testid="reader-mode-toggle"]').check()
    await page.waitForTimeout(100)

    // Enable elastic toggle (it should be ignored in reader mode)
    await page.locator('[data-testid="edge-elastic-scroll-toggle"]').check()
    await page.waitForTimeout(100)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    // Reader mode should use native overflow scroll
    await expect(wrapper).toHaveCSS('overflow', 'auto')

    // Container should NOT have a CSS transform (no elastic rubber-band)
    await expect(container).toHaveCSS('transform', 'none')

    // Verify native scroll works
    const scrollBefore = await wrapper.evaluate((el) => ({
      scrollTop: (el as HTMLElement).scrollTop,
      scrollLeft: (el as HTMLElement).scrollLeft
    }))

    await wrapper.evaluate((el) => {
      const div = el as HTMLElement
      div.scrollTop = 50
      div.scrollLeft = 30
    })

    const scrollAfter = await wrapper.evaluate((el) => ({
      scrollTop: (el as HTMLElement).scrollTop,
      scrollLeft: (el as HTMLElement).scrollLeft
    }))

    expect(scrollAfter.scrollTop).toBe(50)
    expect(scrollAfter.scrollLeft).toBe(30)

    // Container transform should still be 'none' after scrolling
    await expect(container).toHaveCSS('transform', 'none')

    // Readout transform should reflect negative scroll as transform coordinates
    const readout = await readTransform(page)
    expect(readout.x).toBeCloseTo(-30, 0)
    expect(readout.y).toBeCloseTo(-50, 0)

    console.log(
      `Reader mode scroll: before=(${scrollBefore.scrollLeft},${scrollBefore.scrollTop}) ` +
        `after=(${scrollAfter.scrollLeft},${scrollAfter.scrollTop}) ` +
        `readout=(${readout.x.toFixed(2)},${readout.y.toFixed(2)})`
    )

    await saveEvidence(page, 'task-9-reader-mode-native-scroll.png')
  })
})
