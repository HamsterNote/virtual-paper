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
    readonly inlineWidth: string
    readonly inlineHeight: string
    readonly transform: string
    readonly transformOrigin: string
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
    modifiers: 0
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
  await page
    .locator('[data-testid="virtual-paper-wrapper"]')
    .dispatchEvent('wheel', {
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
        marginTop: Number.parseFloat(containerStyle.marginTop) || 0,
        inlineWidth: container.style.width,
        inlineHeight: container.style.height,
        transform: containerStyle.transform,
        transformOrigin: containerStyle.transformOrigin
      }
    }
  })

  expect(snapshot, 'Reader wrapper/container should exist').not.toBeNull()
  if (snapshot === null) throw new Error('Reader layout snapshot unavailable')

  return snapshot
}

async function contentPointUnderPointer(
  page: Page,
  pointer: Point
): Promise<Point> {
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

  test('keeps browser-native momentum after a single-finger touch pan ends', async ({
    page
  }) => {
    await enableReaderMode(page)
    await zoomReaderPastScale(page, 2)

    const singlePanToggle = page.locator(
      '[data-testid="mode-toggle-TouchSingleFingerPan"]'
    )
    if (!(await singlePanToggle.isChecked())) {
      await singlePanToggle.check()
    }
    await expect(singlePanToggle).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')
    await expect
      .poll(async () => (await readReaderLayout(page)).container.transform)
      .toBe('none')
    await expect(wrapper).toHaveCSS('touch-action', /pan-x|pan-y/)
    await expect(container).toHaveCSS('touch-action', /pan-x|pan-y/)

    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) throw new Error('Reader wrapper box unavailable')

    await wrapper.evaluate(async (el) => {
      const settled = new Promise<void>((resolve) => {
        el.addEventListener('scrollend', () => resolve(), { once: true })
      })
      el.scrollTop = 120
      await settled
    })
    await wrapper.evaluate((el) => {
      const timeline: Array<{ readonly type: string; readonly time: number }> = []
      for (const type of ['touchend', 'scroll', 'scrollend']) {
        el.addEventListener(
          type,
          () => {
            timeline.push({ type, time: performance.now() })
            el.dataset.momentumTimeline = JSON.stringify(timeline)
          },
          { passive: true }
        )
      }
    })

    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })

    const x = box.x + box.width / 2
    const startY = box.y + Math.min(box.height - 24, 260)
    const moveOffsets = [8, 20, 38, 62, 92, 128]

    await dispatchTouch(client, 'touchStart', [{ x, y: startY, id: 0 }])
    for (const offset of moveOffsets) {
      await page.waitForTimeout(8)
      await dispatchTouch(client, 'touchMove', [
        { x, y: startY - offset, id: 0 }
      ])
    }

    await dispatchTouch(client, 'touchEnd', [])

    // Then: 原生 touch pan 在抬手后继续推进，不被 React transform 同步截停。
    await expect
      .poll(async () => {
        return wrapper.evaluate((el) => {
          const timeline = JSON.parse(el.dataset.momentumTimeline ?? '[]') as Array<{
            readonly type: string
            readonly time: number
          }>
          const touchEnd = timeline.find((entry) => entry.type === 'touchend')
          if (!touchEnd) return false

          return timeline.some(
            (entry) =>
              entry.type === 'scroll' && entry.time >= touchEnd.time + 50
          )
        })
      })
      .toBe(true)

    await expect
      .poll(async () => {
        return wrapper.evaluate((el) => {
          const timeline = JSON.parse(el.dataset.momentumTimeline ?? '[]') as Array<{
            readonly type: string
            readonly time: number
          }>
          const touchEnd = timeline.find((entry) => entry.type === 'touchend')
          if (!touchEnd) return false

          return timeline.some(
            (entry) =>
              entry.type === 'scrollend' && entry.time >= touchEnd.time
          )
        })
      })
      .toBe(true)

    await expect
      .poll(async () => {
        const [transform, layout] = await Promise.all([
          readTransform(page),
          readReaderLayout(page)
        ])
        return Math.abs(transform.y + layout.wrapper.scrollTop)
      })
      .toBeLessThanOrEqual(1)
    const containerPosition = await container.evaluate((element) => ({
      left: element.style.left,
      top: element.style.top,
      transform: window.getComputedStyle(element).transform
    }))
    expect(containerPosition).toEqual({ left: '', top: '', transform: 'none' })

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

  test('previews wheel zoom with an anchored transform before committing layout', async ({
    page
  }) => {
    await expect(
      page.locator('[data-testid="reader-transform-origin-debug-point"]')
    ).toHaveCount(0)

    await enableReaderMode(page)

    const originMarker = page.locator(
      '[data-testid="reader-transform-origin-debug-point"]'
    )
    await expect(originMarker).toBeVisible()
    await expect(originMarker).toHaveCSS('pointer-events', 'none')

    const before = await readReaderLayout(page)
    const beforeTransform = await readTransform(page)
    const expectedOrigin = {
      x:
        WHEEL_ANCHOR_INSIDE_WRAPPER.clientX -
        before.wrapper.left +
        before.wrapper.scrollLeft -
        before.container.marginLeft,
      y:
        WHEEL_ANCHOR_INSIDE_WRAPPER.clientY -
        before.wrapper.top +
        before.wrapper.scrollTop -
        before.container.marginTop
    }

    await dispatchReaderWheel(page, -220)
    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeGreaterThan(beforeTransform.scale)

    const preview = await readReaderLayout(page)
    expect(preview.container.inlineWidth).toBe(before.container.inlineWidth)
    expect(preview.container.inlineHeight).toBe(before.container.inlineHeight)
    expect(preview.wrapper.scrollLeft).toBe(before.wrapper.scrollLeft)
    expect(preview.wrapper.scrollTop).toBe(before.wrapper.scrollTop)
    expect(preview.container.transform).not.toBe('none')

    const [originX, originY] = preview.container.transformOrigin
      .split(' ')
      .map(Number.parseFloat)
    expect(originX).toBeCloseTo(expectedOrigin.x, 1)
    expect(originY).toBeCloseTo(expectedOrigin.y, 1)
    await expect
      .poll(async () => {
        const markerPosition = await originMarker.evaluate((element) => ({
          left: Number.parseFloat(element.style.left),
          top: Number.parseFloat(element.style.top)
        }))

        return {
          left: Math.round(markerPosition.left),
          top: Math.round(markerPosition.top)
        }
      })
      .toEqual({ left: Math.round(originX), top: Math.round(originY) })

    await saveEvidence(page, 'reader-mode-transform-origin-debug-point.png')

    await expect
      .poll(async () => (await readReaderLayout(page)).container.transform)
      .toBe('none')

    const committed = await readReaderLayout(page)
    expect(committed.container.inlineWidth).not.toBe(before.container.inlineWidth)
    expect(committed.container.inlineHeight).not.toBe(before.container.inlineHeight)

    await saveEvidence(page, 'reader-mode-wheel-preview-commit.png')
  })

  test('zooms smoothly outward and inward around the initial two-finger center', async ({
    page
  }) => {
    await enableReaderMode(page)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) throw new Error('Reader wrapper box unavailable')

    const before = await readReaderLayout(page)
    const startCenter = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    }
    const expectedOrigin = {
      x:
        startCenter.x -
        before.wrapper.left +
        before.wrapper.scrollLeft -
        before.container.marginLeft,
      y:
        startCenter.y -
        before.wrapper.top +
        before.wrapper.scrollTop -
        before.container.marginTop
    }
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })

    await wrapper.evaluate((element) => {
      const events: string[] = []
      const record = (event: Event) => {
        const pointerEvent = event as PointerEvent
        events.push(
          `${event.type}:${pointerEvent.pointerId}:${pointerEvent.clientX}:${pointerEvent.clientY}`
        )
        element.dataset.pointerEvents = JSON.stringify(events)
      }
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel'
      ]) {
        element.addEventListener(type, record)
      }
    })
    await dispatchTouch(client, 'touchStart', [
      { x: startCenter.x - 60, y: startCenter.y, id: 0 }
    ])
    await dispatchTouch(client, 'touchStart', [
      { x: startCenter.x - 60, y: startCenter.y, id: 0 },
      { x: startCenter.x + 60, y: startCenter.y, id: 1 }
    ])
    const scaleSamples: number[] = []
    for (const distance of [140, 160, 180, 160, 140, 100]) {
      await dispatchTouch(client, 'touchMove', [
        {
          x: startCenter.x - distance / 2,
          y: startCenter.y,
          id: 0
        },
        {
          x: startCenter.x + distance / 2,
          y: startCenter.y,
          id: 1
        }
      ])
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      )
      scaleSamples.push((await readTransform(page)).scale)
    }

    expect(scaleSamples.slice(0, 3)).toEqual(
      [...scaleSamples.slice(0, 3)].sort((left, right) => left - right)
    )
    expect(scaleSamples.slice(2)).toEqual(
      [...scaleSamples.slice(2)].sort((left, right) => right - left)
    )
    expect(Math.max(...scaleSamples)).toBeLessThan(2)
    expect(scaleSamples[scaleSamples.length - 1]).toBeLessThan(1)
    const pointerEvents = JSON.parse(
      (await wrapper.getAttribute('data-pointer-events')) ?? '[]'
    ) as string[]
    expect(pointerEvents.some((event) => event.startsWith('pointercancel'))).toBe(false)

    await expect
      .poll(async () => (await readReaderLayout(page)).container.transform)
      .not.toBe('none')

    const preview = await readReaderLayout(page)
    expect(preview.container.inlineWidth).toBe(before.container.inlineWidth)
    expect(preview.container.inlineHeight).toBe(before.container.inlineHeight)
    expect(preview.wrapper.scrollLeft).toBe(before.wrapper.scrollLeft)
    expect(preview.wrapper.scrollTop).toBe(before.wrapper.scrollTop)
    const previewPosition = await page
      .locator('[data-testid="virtual-paper-container"]')
      .evaluate((element) => ({
        left: element.style.left,
        top: element.style.top
      }))
    expect(previewPosition).toEqual({ left: '', top: '' })

    const [originX, originY] = preview.container.transformOrigin
      .split(' ')
      .map(Number.parseFloat)
    expect(originX).toBeCloseTo(expectedOrigin.x, 1)
    expect(originY).toBeCloseTo(expectedOrigin.y, 1)

    await dispatchTouch(client, 'touchEnd', [])

    await expect
      .poll(async () => (await readReaderLayout(page)).container.transform)
      .toBe('none')

    const committed = await readReaderLayout(page)
    expect(committed.container.inlineWidth).not.toBe(before.container.inlineWidth)
    expect(committed.container.inlineHeight).not.toBe(before.container.inlineHeight)

    await saveEvidence(page, 'reader-mode-touch-preview-commit.png')
  })

  test('starts a reversible pinch after native one-finger scrolling has begun', async ({
    page
  }) => {
    await enableReaderMode(page)

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) throw new Error('Reader wrapper box unavailable')

    await wrapper.evaluate((element) => {
      const pointerEvents: string[] = []
      const touchEvents: string[] = []
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel'
      ]) {
        element.addEventListener(type, (event) => {
          const pointerEvent = event as PointerEvent
          pointerEvents.push(`${type}:${pointerEvent.pointerId}`)
          element.dataset.pointerEvents = JSON.stringify(pointerEvents)
        })
      }
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        element.addEventListener(type, (event) => {
          const touchEvent = event as TouchEvent
          touchEvents.push(
            `${type}:${Array.from(touchEvent.touches)
              .map((touch) => `${touch.identifier}@${touch.clientX},${touch.clientY}`)
              .join('|')}`
          )
          element.dataset.touchEvents = JSON.stringify(touchEvents)
        })
      }
    })

    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const first = { x: center.x - 60, y: center.y, id: 0 }
    const scrolledFirst = { ...first, y: center.y - 80 }

    // Given: 第一根手指已经移动并让浏览器开始原生滚动。
    await dispatchTouch(client, 'touchStart', [first])
    await dispatchTouch(client, 'touchMove', [scrolledFirst])
    await expect
      .poll(async () => (await readReaderLayout(page)).wrapper.scrollTop)
      .toBeGreaterThan(0)
    const baselineScale = (await readTransform(page)).scale

    // When: 第二根手指加入，并先向外再向内移动。
    const second = { x: center.x + 60, y: scrolledFirst.y, id: 1 }
    await dispatchTouch(client, 'touchStart', [scrolledFirst, second])
    await dispatchTouch(client, 'touchMove', [
      { ...scrolledFirst, x: center.x - 90 },
      { ...second, x: center.x + 90 }
    ])
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    const outwardScale = (await readTransform(page)).scale
    await dispatchTouch(client, 'touchMove', [
      { ...scrolledFirst, x: center.x - 40 },
      { ...second, x: center.x + 40 }
    ])
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    const eventTrace = await wrapper.evaluate((element) => ({
      pointerEvents: JSON.parse(element.dataset.pointerEvents ?? '[]') as string[],
      touchEvents: JSON.parse(element.dataset.touchEvents ?? '[]') as string[]
    }))

    // Then: 原生滚动接管后加入的双指手势仍可放大并反向缩小。
    expect(outwardScale, JSON.stringify(eventTrace)).toBeGreaterThan(
      baselineScale
    )
    await expect
      .poll(async () => (await readTransform(page)).scale, {
        message: JSON.stringify(eventTrace)
      })
      .toBeLessThan(baselineScale)
    const inwardScale = (await readTransform(page)).scale

    await dispatchTouch(client, 'touchEnd', [])
    await expect
      .poll(async () => (await readReaderLayout(page)).container.transform)
      .toBe('none')

    // Then: 晚到的 scrollend/fallback 不能用旧滚动姿态覆盖已提交的 pinch。
    await page.waitForTimeout(180)
    await expect
      .poll(async () => (await readTransform(page)).scale)
      .toBeCloseTo(inwardScale, 3)
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
    await expect
      .poll(async () => (await readReaderLayout(page)).container.transform)
      .toBe('none')

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

    expect(layout.container.width).toBeLessThanOrEqual(
      layout.wrapper.clientWidth
    )
    expect(layout.container.height).toBeLessThanOrEqual(
      layout.wrapper.clientHeight
    )
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
    await expect
      .poll(async () => (await readReaderLayout(page)).container.transform)
      .toBe('none')

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
      div.scrollLeft = Math.max(
        1,
        Math.floor((div.scrollWidth - div.clientWidth) / 2)
      )
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
        scrollLeft:
          Math.round(
            mixedAxisLayout.wrapper.scrollWidth -
              mixedAxisLayout.wrapper.clientWidth
          ) > 1
            ? Math.max(
                1,
                Math.floor(
                  (mixedAxisLayout.wrapper.scrollWidth -
                    mixedAxisLayout.wrapper.clientWidth) /
                    2
                )
              )
            : 1,
        scrollTop: 0,
        x: -Math.max(
          1,
          Math.floor(
            (mixedAxisLayout.wrapper.scrollWidth -
              mixedAxisLayout.wrapper.clientWidth) /
              2
          )
        ),
        y: 0
      })

    const scrolledLayout = await readReaderLayout(page)
    const scrolledTransform = await readTransform(page)
    expect(
      scrolledLayout.wrapper.scrollLeft + Math.round(scrolledTransform.x)
    ).toBe(0)
    expect(
      scrolledLayout.wrapper.scrollTop + Math.round(scrolledTransform.y)
    ).toBe(0)

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

  /**
   * Contract: reader mode intentionally excludes `will-change: transform` from
   * the container even when `lazyWillChange` is enabled. In reader mode the
   * container uses native scroll + layout (margins/width/height) rather than
   * CSS `transform`, so a `will-change: transform` hint would be misleading
   * and wasteful. This test locks that exclusion.
   */
  test('lazyWillChange does not apply will-change transform in reader mode after touch pan', async ({
    page
  }) => {
    await enableReaderMode(page)

    // 启用 lazyWillChange
    const lazyToggle = page.locator('[data-testid="lazy-will-change-toggle"]')
    await lazyToggle.check()
    await expect(lazyToggle).toBeChecked()

    const wrapper = page.locator('[data-testid="virtual-paper-wrapper"]')
    const container = page.locator('[data-testid="virtual-paper-container"]')

    // 重置滚动位置
    await wrapper.evaluate((el) => {
      el.scrollTop = 0
    })

    // 使用 CDP 触摸模拟进行单指滑动
    const box = await wrapper.boundingBox()
    expect(box).not.toBeNull()
    if (box === null) throw new Error('Reader wrapper box unavailable')

    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true })

    const x = box.x + box.width / 2
    const startY = box.y + Math.min(box.height - 24, 260)
    const endY = box.y + 48

    await dispatchTouch(client, 'touchStart', [{ x, y: startY, id: 0 }])
    await dispatchTouch(client, 'touchMove', [{ x, y: endY, id: 0 }])
    await dispatchTouch(client, 'touchEnd', [{ x, y: endY, id: 0 }])

    // 断言: wrapper 发生了原生滚动
    await expect
      .poll(async () => {
        const layout = await readReaderLayout(page)
        return layout.wrapper.scrollTop
      })
      .toBeGreaterThan(0)

    // 断言: container 的 transform 仍然是 none（reader 模式不使用 transform 定位）
    const transform = await container.evaluate(
      (el) => getComputedStyle(el).transform
    )
    expect(transform).toBe('none')

    // 断言: will-change 不是 transform（reader 模式使用原生滚动，不需要 transform 提示）
    const willChange = await container.evaluate(
      (el) => getComputedStyle(el).willChange
    )
    expect(willChange).not.toBe('transform')

    await saveEvidence(page, 'reader-mode-touch-will-change-contract.png')
  })

  test('keeps default transform mode CSS transform and wheel pan behavior', async ({
    page
  }) => {
    await expect(
      page.locator('[data-testid="reader-mode-toggle"]')
    ).not.toBeChecked()

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
