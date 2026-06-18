import { expect, test } from '@playwright/test'

test('loads the VirtualPaper demo', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'VirtualPaper 控制器' })
  ).toBeVisible()
})
