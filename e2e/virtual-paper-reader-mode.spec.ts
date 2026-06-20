import { expect, test } from '@playwright/test'
import type { CDPSession, Page } from '@playwright/test'

const EVIDENCE_DIR = '.omo/evidence'
const TRANSFORM_RE = /x: ([\d.-]+), y: ([\d.-]+), scale: ([\d.-]+)/
const CONTENT_SIZE = { width: 600, height: 400 }
const READER_SCROLLABLE_VIEWPORT = { width: 760, height: 360 }
const WHEEL_ANCHOR_INSIDE_WRAPPER = { clientX: 420, clientY: 180 }

type Point = {
  readonly x: number
  readonly y: number
}

type ReaderLayoutSnapshot = {
  readonly wrapper: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
    readonly clientWidth: number
    readonly clientHeight: number
    readonly scrollLeft: number
    readonly scrollTop: number
    readonly scrollWidth: number
    readonly scrollHeight: number
  }
  readonly container: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
    readonly marginLeft: number
    readonly marginTop: number
  }
}

type TransformReadout = {
  x: number
  y: number
  scale: number
}

type TouchPoint = Point & {
  readonly id: number
}

async function dispatchTouch(
  client: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: readonly TouchPoint[]
) {
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point) => ({
      x: point.x,
      y: point.y,
      radiusX: 1,
      radiusY: 1,
      force: 1,
      id: point.id
    })),
    modifiers: 0,
    timestamp: Date.now()
  })
}

async function readTransform(page: Page): Promise<TransformReadout> {
  const readout = page.locator('[data-testid="transform-readout"]')
  const text = await readout.innerText()
  const match = text.match(TRANSFORM_RE)

  expect(match, `Unexpected transform readout: ${text}`).not.toBeNull()

  return {
    x: Number(match?.[1]),
    y: Number(match?.[2]),
    scale: Number(match?.[3])
  }
}

async function waitForTransformChange(
  page: Page,
  initial: TransformReadout,
  fields: Array<keyof TransformReadout>
) {
  await expect
    .poll(async () => {
      const current = await readTransform(page)

      return fields.every((field) => current[field] !== initial[field])
    })
    .toBe(true)
}

async function saveEvidence(page: Page, fileName: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${fileName}`, fullPage: true })
}

async function dispatchReaderWheel(page: Page, deltaY: number) {
  await page.locator('[data-testid="virtual-paper-wrapper"]').dispatchEvent('wheel', {
    ctrlKey: true,
    ...WHEEL_ANCHOR_INSIDE_WRAPPER,
    deltaY
  })
}

async function readReaderLayout(page: Page): Promise<ReaderLayoutSnapshot> {
  const snapshot = await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>(
      '[data-testid="virtual-paper-wrapper"]'
    )
    const container = document.querySelector<HTMLElement>(
      '[data-testid="virtual-paper-container"]'
    )

    if (wrapper === null || container === null) return null

    const wrapperRect = wrapper.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const containerStyle = window.getComputedStyle(container)

    return {
      wrapper: {
        left: wrapperRect.left,
        top: wrapperRect.top,
        width: wrapperRect.width,
        height: wrapperRect.height,
        clientWidth: wrapper.clientWidth,
        clientHeight: wrapper.clientHeight,
        scrollLeft: wrapper.scrollLeft,
        scrollTop: wrapper.scrollTop,
        scrollWidth: wrapper.scrollWidth,
        scrollHeight: wrapper.scrollHeight
      },
      container: {
        left: containerRect.left,
        top: containerRect.top,
        width: containerRect.width,
        height: containerRect.height,
        marginLeft: Number.parseFloat(containerStyle.marginLeft) || 0,
        marginTop: Number.parseFloat(containerStyle.marginTop) || 0
      }
    }
  })

  expect(snapshot, 'Reader wrapper/container should exist').not.toBeNull()
  if (snapshot === null) throw new Error('Reader layout snapshot unavailable')

  return snapshot
}

async function contentPointUnderPointer(page: Page, pointer: Point): Promise<Point> {
  const [layout, transform] = await Promise.all([
    readReaderLayout(page),
    readTransform(page)
  ])

  return {
    x: (pointer.x - layout.container.left) / transform.scale,
    y: (pointer.y - layout.container.top) / transform.scale
  }
}

async function enableReaderMode(page: Page) {
  await page.locator('[data-testid="reader-mode-toggle"]').check()
  await expect(page.locator('[data-testid="reader-mode-toggle"]')).toBeChecked()
  await expect(page.locator('[data-testid="virtual-paper-wrapper"]')).toHaveCSS(
    'overflow',
    'auto'
  )
}

async function zoomReaderPastScale(page: Page, targetScale: number) {
  const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')

  for (let i = 0; i < 8; i += 1) {
    const before = await readTransform(page)
    if (before.scale > targetScale) return before

    await wrapper.dispatchEvent('wheel', {
      ctrlKey: true,
      ...WHEEL_ANCHOR_INSIDE_WRAPPER,
      deltaY: -220
    })

    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(before.scale)
  }

  const current = await readTransform(page)
  expect(current.scale).toBeGreaterThan(targetScale)
  return current
}

test.describe('VirtualPaper readerMode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(READER_SCROLLABLE_VIEWPORT)
    await page.goto('/')
  })

  test('renders 2-layer reader structure without container transform', async ({
    page
  }) => {
    await enableReaderMode(page)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    await expect(wrapper).toBeVisible()
    await expect(container).toBeVisible()
    await expect(wrapper).toHaveCSS('overflow', 'auto')
    await expect(container).toHaveCSS('transform', /none/)
    await expect(container).toHaveCSS('position', 'relative')

    const geometry = await container.evaluate((el) => {
      const style = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()

      return {
        position: style.position,
        transform: style.transform,
        width: rect.width,
        height: rect.height
      }
    })

    expect(geometry.position).toBe('relative')
    expect(geometry.transform).toBe('none')
    expect(Math.round(geometry.width)).toBe(CONTENT_SIZE.width)
    expect(Math.round(geometry.height)).toBe(CONTENT_SIZE.height)

    await saveEvidence(page, 'reader-mode-structure.png')
  })

  test('syncs native scroll positions back to negative transform coordinates', async ({
    page
  }) => {
    await enableReaderMode(page)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')

    await wrapper.evaluate((el) => {
      const div = el as HTMLElement
      div.scrollLeft = 100
      div.scrollTop = 30
    })

    await expect
      .poll(async () => {
        const current = await readTransform(page)
        return {
          x: Math.round(current.x),
          y: Math.round(current.y)
        }
      })
      .toEqual({ x: -100, y: -30 })

    await saveEvidence(page, 'reader-mode-native-scroll-sync.png')
  })

  test('scrolls with browser-native single-finger touch pan in readerMode', async ({
    page
  }) => {
    await enableReaderMode(page)

    const singlePanToggle = page.locator(
      '[data-testid="mode-toggle-TouchSingleFingerPan"]'
    )
    if (!(await singlePanToggle.isChecked())) {
      await singlePanToggle.check()
    }
    await expect(singlePanToggle).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')
    await expect(wrapper).toHaveCSS('touch-action', /pan-x|pan-y/)
    await expect(container).toHaveCSS('touch-action', /pan-x|pan-y/)

    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) throw new Error('Reader wrapper box unavailable')

    await wrapper.evaluate((el) => {
      el.scrollTop = 0
    })

    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })

    const x = box.x + box.width / 2
    const startY = box.y + Math.min(box.height - 24, 260)
    const endY = box.y + 48

    await dispatchTouch(client, 'touchStart', [{ x, y: startY, id: 0 }])
    await dispatchTouch(client, 'touchMove', [{ x, y: endY, id: 0 }])
    await dispatchTouch(client, 'touchEnd', [{ x, y: endY, id: 0 }])

    await expect
      .poll(async () => {
        const layout = await readReaderLayout(page)
        return layout.wrapper.scrollTop
      })
      .toBeGreaterThan(0)

    const transform = await readTransform(page)
    expect(transform.y).toBeLessThan(0)

    await saveEvidence(page, 'reader-mode-touch-pan-scroll.png')
  })

  test('increases scale after ctrl wheel zoom debounce', async ({ page }) => {
    await enableReaderMode(page)

    for (let i = 0; i < 3; i += 1) {
      const before = await readTransform(page)
      await dispatchReaderWheel(page, -200)
      await expect
        .poll(async () => (await readTransform(page)).scale)
        .toBeGreaterThan(before.scale)
    }

    await saveEvidence(page, 'reader-mode-ctrl-wheel-zoom.png')
  })

  test('centers fit reader content with native margins and zero scroll', async ({
    page
  }) => {
    await enableReaderMode(page)

    for (let i = 0; i < 4; i += 1) {
      const before = await readTransform(page)
      if (before.scale <= 0.7) break

      await dispatchReaderWheel(page, 300)
      await expect
        .poll(async () => (await readTransform(page)).scale)
        .toBeLessThan(before.scale)
    }

    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeLessThanOrEqual(0.7)

    const transform = await readTransform(page)
    const layout = await readReaderLayout(page)
    const wrapperCenter = {
      x: layout.wrapper.left + layout.wrapper.clientWidth / 2,
      y: layout.wrapper.top + layout.wrapper.clientHeight / 2
    }
    const containerCenter = {
      x: layout.container.left + layout.container.width / 2,
      y: layout.container.top + layout.container.height / 2
    }

    expect(layout.container.width).toBeLessThanOrEqual(layout.wrapper.clientWidth)
    expect(layout.container.height).toBeLessThanOrEqual(layout.wrapper.clientHeight)
    expect(layout.container.marginLeft).toBeGreaterThan(0)
    expect(layout.container.marginTop).toBeGreaterThan(0)
    expect(layout.wrapper.scrollLeft).toBe(0)
    expect(layout.wrapper.scrollTop).toBe(0)
    expect(transform.x).toBeCloseTo(0, 2)
    expect(transform.y).toBeCloseTo(0, 2)
    expect(Math.abs(containerCenter.x - wrapperCenter.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(containerCenter.y - wrapperCenter.y)).toBeLessThanOrEqual(2)

    await saveEvidence(page, 'reader-mode-centered-fit-margins.png')
  })

  test('round-trips overflow native scroll to negative transform coordinates', async ({
    page
  }) => {
    await enableReaderMode(page)

    const initial = await readTransform(page)
    await dispatchReaderWheel(page, 80)
    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeLessThan(initial.scale)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const mixedAxisLayout = await readReaderLayout(page)
    expect(mixedAxisLayout.container.width).toBeGreaterThan(
      mixedAxisLayout.wrapper.clientWidth
    )
    expect(mixedAxisLayout.container.height).toBeLessThanOrEqual(
      mixedAxisLayout.wrapper.clientHeight
    )
    expect(mixedAxisLayout.container.marginLeft).toBe(0)
    expect(mixedAxisLayout.container.marginTop).toBeGreaterThan(0)

    await wrapper.evaluate((el) => {
      const div = el as HTMLElement
      div.scrollLeft = Math.max(1, Math.floor((div.scrollWidth - div.clientWidth) / 2))
      div.scrollTop = 0
    })

    await expect
      .poll(async () => {
        const [layout, transform] = await Promise.all([
          readReaderLayout(page),
          readTransform(page)
        ])

        return {
          marginLeft: Math.round(layout.container.marginLeft),
          marginTop: Math.round(layout.container.marginTop),
          scrollLeft: Math.round(layout.wrapper.scrollLeft),
          scrollTop: Math.round(layout.wrapper.scrollTop),
          x: Math.round(transform.x),
          y: Math.round(transform.y)
        }
      })
      .toEqual({
        marginLeft: 0,
        marginTop: Math.round(mixedAxisLayout.container.marginTop),
        scrollLeft: Math.round(mixedAxisLayout.wrapper.scrollWidth - mixedAxisLayout.wrapper.clientWidth) > 1
          ? Math.max(
              1,
              Math.floor(
                (mixedAxisLayout.wrapper.scrollWidth - mixedAxisLayout.wrapper.clientWidth) / 2
              )
            )
          : 1,
        scrollTop: 0,
        x: -Math.max(
          1,
          Math.floor(
            (mixedAxisLayout.wrapper.scrollWidth - mixedAxisLayout.wrapper.clientWidth) / 2
          )
        ),
        y: 0
      })

    const scrolledLayout = await readReaderLayout(page)
    const scrolledTransform = await readTransform(page)
    expect(scrolledLayout.wrapper.scrollLeft + Math.round(scrolledTransform.x)).toBe(0)
    expect(scrolledLayout.wrapper.scrollTop + Math.round(scrolledTransform.y)).toBe(0)

    await saveEvidence(page, 'reader-mode-overflow-scroll-round-trip.png')
  })

  test('keeps fixed pointer content coordinate during ctrl wheel anchored zoom', async ({
    page
  }) => {
    await enableReaderMode(page)

    const pointer = {
      x: WHEEL_ANCHOR_INSIDE_WRAPPER.clientX,
      y: WHEEL_ANCHOR_INSIDE_WRAPPER.clientY
    }
    const beforeTransform = await readTransform(page)
    const beforePoint = await contentPointUnderPointer(page, pointer)

    await dispatchReaderWheel(page, -220)
    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(beforeTransform.scale)

    await expect
      .poll(async () => {
        const afterPoint = await contentPointUnderPointer(page, pointer)
        return Math.max(
          Math.abs(afterPoint.x - beforePoint.x),
          Math.abs(afterPoint.y - beforePoint.y)
        )
      })
      .toBeLessThanOrEqual(5)

    await saveEvidence(page, 'reader-mode-anchored-zoom-invariant.png')
  })

  test('keeps zoomed reader layout bounded without blank overflow', async ({
    page
  }) => {
    await enableReaderMode(page)

    const scale = (await zoomReaderPastScale(page, 2)).scale
    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    const containerBox = await container.boundingBox()
    expect(containerBox).not.toBeNull()
    expect(containerBox!.width).toBeCloseTo(CONTENT_SIZE.width * scale, 0)
    expect(containerBox!.height).toBeCloseTo(CONTENT_SIZE.height * scale, 0)

    const bounds = await wrapper.evaluate((el) => {
      const div = el as HTMLElement
      const maxScrollLeft = Math.max(0, div.scrollWidth - div.clientWidth)
      const maxScrollTop = Math.max(0, div.scrollHeight - div.clientHeight)

      return {
        scrollLeft: div.scrollLeft,
        scrollTop: div.scrollTop,
        scrollWidth: div.scrollWidth,
        scrollHeight: div.scrollHeight,
        clientWidth: div.clientWidth,
        clientHeight: div.clientHeight,
        maxScrollLeft,
        maxScrollTop
      }
    })

    expect(bounds.scrollWidth).toBeGreaterThanOrEqual(bounds.clientWidth)
    expect(bounds.scrollHeight).toBeGreaterThanOrEqual(bounds.clientHeight)
    expect(bounds.scrollLeft).toBeGreaterThanOrEqual(0)
    expect(bounds.scrollTop).toBeGreaterThanOrEqual(0)
    expect(bounds.scrollLeft).toBeLessThanOrEqual(bounds.maxScrollLeft + 1)
    expect(bounds.scrollTop).toBeLessThanOrEqual(bounds.maxScrollTop + 1)

    await saveEvidence(page, 'reader-mode-bounded-zoom.png')
  })

  test('keeps default transform mode CSS transform and wheel pan behavior', async ({
    page
  }) => {
    await expect(page.locator('[data-testid="reader-mode-toggle"]')).not.toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')
    const initial = await readTransform(page)

    await expect(container).toHaveCSS('transform', /matrix/)

    await wrapper.dispatchEvent('wheel', { deltaX: 50, deltaY: 30 })
    await waitForTransformChange(page, initial, ['x', 'y'])

    const current = await readTransform(page)
    expect(current.x).toBeLessThan(initial.x)
    expect(current.y).toBeLessThan(initial.y)
    await expect(container).toHaveCSS('transform', /matrix/)

    await saveEvidence(page, 'reader-mode-transform-regression.png')
  })
})
