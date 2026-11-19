import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const baseUrl = 'http://127.0.0.1:' + port
const app = spawn(process.execPath, ['.output/server/index.mjs'], {
  cwd, env: { ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1' }, stdio: 'ignore',
})
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(baseUrl)).ok) break } catch {}
    if (attempt >= 75 || app.exitCode !== null) throw new Error('请先执行 pnpm build；独立预览服务未就绪')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const user = { userId: 'MOCK-USER', username: 'test', displayName: '测试用户', role: 'USER' }
  const project = {
    projectId: 'OFFICE-PROJECT-001', name: '默认办公项目', customerRequirements: '', requirementsRevision: 1,
    leader: { ...user, role: 'LEADER' }, collaborators: [], referenceImages: [],
    floors: [{ projectId: 'OFFICE-PROJECT-001', floorId: 'OFFICE-PROJECT-001', name: '默认楼层', sortOrder: 1 }],
  }
  const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="600"><rect width="1100" height="600" fill="white"/><path d="M100 100H700V500H100Z" fill="none" stroke="black" stroke-width="4"/></svg>'
  const source = {
    analysisId: 'REVIEW-TEST', status: 'awaiting_confirm', sourceName: '平面图测试.png', inputMode: 'image',
    previewUrl: 'data:image/svg+xml;base64,' + Buffer.from(sourceSvg).toString('base64'),
    previewBounds: { minX: 0, minY: 0, maxX: 1100, maxY: 600 },
    unitResolution: { canonicalUnit: 'px', confirmed: false },
    rooms: [{ roomId: 'TEST-ROOM', label: '测试会议室', roomType: 'MEETING_ROOM', polygon: [[100, 100], [700, 100], [700, 500], [100, 500]], geometrySource: 'ai_vision' }],
  }
  await context.route('**/api/auth/me', route => route.fulfill({ json: { code: 200, data: user } }))
  await context.route('**/api/v1/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const data = path === '/api/v1/office/projects' && request.method() === 'GET' ? [project]
      : path === '/api/v1/floor-plan/REVIEW-TEST' ? source
        : path.endsWith('/canvas') ? null : []
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 200, data }) })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const canvas = page.getByRole('img', { name: '空间核对画布', exact: true })
  const selectTool = page.getByRole('button', { name: '选择 / 缩放', exact: true })
  const panTool = page.getByRole('button', { name: '拖动画布', exact: true })
  const activeTool = name => page.waitForFunction(expected => document.querySelector('.review-tools button.active')?.textContent?.trim() === expected, name, { timeout: 3000 })
  const sourceScreenPoint = point => canvas.locator('[data-layer="underlay"]').evaluate((group, value) => {
    const transformed = new DOMPoint(value[0], value[1]).matrixTransform(group.getScreenCTM())
    return { x: transformed.x, y: transformed.y }
  }, point)
  const designSourceGeometry = () => canvas.locator('[data-layer="design"]>g:first-child>path').evaluate(path => {
    const inverse = path.ownerSVGElement.querySelector('[data-layer="underlay"]').getScreenCTM().inverse()
    const toSource = inverse.multiply(path.getScreenCTM())
    return [...path.getAttribute('d').matchAll(/[ML]([-\d.eE]+),([-\d.eE]+)/g)].map(match => {
      const point = new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(toSource)
      return [Number(point.x.toFixed(3)), Number(point.y.toFixed(3))]
    })
  })
  const selectedSpace = () => page.locator('.review-room-card.selected').getAttribute('aria-label')

  await page.goto(baseUrl + '/canvas?analysisId=REVIEW-TEST', { waitUntil: 'networkidle' })
  await canvas.waitFor()
  await selectTool.click()
  const originalGeometry = await designSourceGeometry()
  const originalSelection = await selectedSpace()
  const originalAnchor = await sourceScreenPoint([300, 300])

  const toolbarZoom = page.locator('.review-toolbar .review-zoom-slider')
  await toolbarZoom.waitFor()
  assert.equal(await page.locator('.review-zoom-slider').count(), 1, '页面只保留一个缩放条')
  assert.equal(await page.locator('.review-canvas-bottom .review-zoom-slider').count(), 0, '画布底部不再显示缩放条')
  const zoomRange = page.getByRole('slider', { name: '画布缩放百分比', exact: true })
  assert.equal(await zoomRange.inputValue(), '100')
  const fitButton = page.getByRole('button', { name: '适屏', exact: true })
  const compareButton = page.getByRole('button', { name: '按住对照原图', exact: true })
  const zoomBox = await toolbarZoom.boundingBox(), fitBox = await fitButton.boundingBox()
  const compareBox = await compareButton.boundingBox(), canvasBox = await canvas.boundingBox()
  const toolbarBox = await page.locator('.review-toolbar').boundingBox()
  assert.ok(zoomBox && fitBox && compareBox && canvasBox && toolbarBox)
  assert.ok(zoomBox.y >= toolbarBox.y && zoomBox.y + zoomBox.height <= toolbarBox.y + toolbarBox.height, '缩放条位于顶部工具栏内')
  assert.ok(zoomBox.x + zoomBox.width <= fitBox.x, '缩放条位于适屏按钮左侧')
  assert.ok(compareBox.y >= canvasBox.y && compareBox.y + compareBox.height <= canvasBox.y + canvasBox.height, '按住对照原图仍位于画布底部')
  await page.getByTestId('zoom-in-slider').click()
  assert.ok(Number(await zoomRange.inputValue()) > 100, '缩放条加号放大画布')
  await page.getByTestId('zoom-out-slider').click()
  assert.equal(await zoomRange.inputValue(), '100', '缩放条减号缩小并恢复')
  const zoomHint = page.getByText('可以通过 ALT + 滚轮进行调整', { exact: true })
  assert.equal(await zoomHint.count(), 0, '未拖动滑块时不显示快捷键提示')
  await zoomRange.evaluate(input => { input.value = '160'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForFunction(() => document.querySelector('.review-zoom-slider output')?.textContent?.trim() === '160%')
  await zoomHint.waitFor({ timeout: 3000 })
  const hintBox = await zoomHint.boundingBox()
  assert.ok(hintBox && hintBox.y >= zoomBox.y + zoomBox.height, '快捷键提示显示在顶部缩放条下方')
  assert.deepEqual(await designSourceGeometry(), originalGeometry, '滑块缩放不改变空间几何')
  assert.equal(await selectedSpace(), originalSelection, '滑块缩放不改变选中空间')
  await zoomHint.waitFor({ state: 'hidden', timeout: 5000 })
  await zoomRange.evaluate(input => { input.value = '100'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  assert.equal(await zoomHint.count(), 0, '后续拖动不重复显示快捷键提示')

  await page.evaluate(() => {
    window.__overviewGestureEvents = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'contextmenu']) {
      document.addEventListener(type, event => {
        if (event.button === 2 || (type === 'pointermove' && event.buttons === 2)) window.__overviewGestureEvents.push(type)
      })
    }
  })

  await page.mouse.move(originalAnchor.x, originalAnchor.y)
  await page.mouse.down({ button: 'right' })
  await activeTool('拖动画布')
  assert.ok(!(await selectTool.getAttribute('class'))?.includes('active'))
  await page.mouse.move(originalAnchor.x + 90, originalAnchor.y + 45, { steps: 5 })
  const movedAnchor = await sourceScreenPoint([300, 300])
  assert.ok(Math.abs(movedAnchor.x - originalAnchor.x - 90) < 0.1)
  assert.ok(Math.abs(movedAnchor.y - originalAnchor.y - 45) < 0.1)
  assert.deepEqual(await designSourceGeometry(), originalGeometry, '右键平移不改变空间几何')
  assert.equal(await selectedSpace(), originalSelection, '右键平移不改变空间选中状态')

  const contextMenuPrevented = await canvas.evaluate(element => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    element.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(contextMenuPrevented, true)
  await page.mouse.up({ button: 'right' })
  await activeTool('选择 / 缩放')
  assert.ok(!(await panTool.getAttribute('class'))?.includes('active'))
  const releasedAnchor = await sourceScreenPoint([300, 300])
  assert.ok(Math.abs(releasedAnchor.x - movedAnchor.x) < 0.1 && Math.abs(releasedAnchor.y - movedAnchor.y) < 0.1, '松开右键后画布不回弹')
  assert.deepEqual(await page.evaluate(() => window.__overviewGestureEvents), [], '画布右键拖动事件不传播给页面外层手势监听')

  const labelAnchor = await sourceScreenPoint([400, 300])
  await page.mouse.move(labelAnchor.x, labelAnchor.y)
  await page.mouse.down({ button: 'right' })
  await activeTool('拖动画布')
  await page.mouse.move(labelAnchor.x + 30, labelAnchor.y + 15, { steps: 3 })
  await page.mouse.up({ button: 'right' })
  await activeTool('选择 / 缩放')
  assert.deepEqual(await designSourceGeometry(), originalGeometry, '从选中标签右键平移不改变空间几何')

  await page.mouse.down({ button: 'right' })
  await activeTool('拖动画布')
  await canvas.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up({ button: 'right' })
  await activeTool('选择 / 缩放')

  await page.mouse.down({ button: 'right' })
  await activeTool('拖动画布')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up({ button: 'right' })
  await activeTool('选择 / 缩放')
  await page.mouse.down({ button: 'right' })
  await activeTool('拖动画布')
  await page.mouse.up({ button: 'right' })
  await activeTool('选择 / 缩放')

  const zoomA = await sourceScreenPoint([100, 100]), zoomB = await sourceScreenPoint([700, 500])
  const beforeDistance = Math.hypot(zoomB.x - zoomA.x, zoomB.y - zoomA.y)
  await page.mouse.move(originalAnchor.x, originalAnchor.y)
  await page.keyboard.down('Alt')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Alt')
  const zoomedA = await sourceScreenPoint([100, 100]), zoomedB = await sourceScreenPoint([700, 500])
  assert.ok(Math.hypot(zoomedB.x - zoomedA.x, zoomedB.y - zoomedA.y) > beforeDistance, 'Alt + 滚轮放大视图')
  assert.deepEqual(await designSourceGeometry(), originalGeometry, '缩放不改变空间几何')
  assert.equal(await selectedSpace(), originalSelection)
  assert.deepEqual(errors, [])
  console.log('空间总览右键临时平移、取消/失焦恢复及 Alt + 滚轮缩放验证通过')
} finally {
  if (browser) await browser.close()
  app.kill()
}
