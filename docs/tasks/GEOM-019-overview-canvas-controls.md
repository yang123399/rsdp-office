# GEOM-019 空间总览右键临时平移

状态：已编码待验证
更新日期：2026-11-17
基线/交付版本：feature/overview-canvas-controls（基于 origin/main 937f7cf，功能代码 ad8b527）

## 目标与验收

在空间总览的“选择 / 缩放”状态下，按住右键拖动时临时显示“拖动画布”，松开、取消或失焦后恢复“选择 / 缩放”。画布保留拖动后的位置，原工具状态、选中空间、设计几何和复核状态不变。Alt + 滚轮继续以鼠标位置为锚点缩放；普通滚轮保持现有行为。

## 设计约束

- 仅修改空间总览，不改变家具排版画布的右键语义。
- 临时平移是交互覆盖状态，不写入持久 `tool`，避免触发工具切换清理逻辑。
- 仅相机 `panX/panY/zoom` 改变；业务对象和物理尺寸不变。
- 右键菜单只在空间总览 SVG 画布内阻止。
- 不新增依赖，不修改后端或数据库，不自动提交 Git。

## 文件与实施步骤

### Task 1: 空间总览右键临时平移

**步骤 1：回归测试**

- 新增 `frontend/scripts/e2e-overview-canvas-controls.mjs`，使用有效项目、楼层和识别结果 mock 进入真实空间总览组件。
- 在选择 / 缩放状态下记录选中空间、业务对象和屏幕坐标。
- 右键按下并移动：断言“拖动画布”高亮、“选择 / 缩放”不高亮，视图移动且对象不变。
- 右键松开：断言恢复“选择 / 缩放”，画布不回弹，选中状态和对象不变。
- 验证 Alt + 滚轮缩放不改变业务对象。
- 先运行测试，确认旧实现因右键不能平移而失败。

**步骤 2：临时平移手势**

- 修改 `frontend/app/components/OfficeCanvas/SpatialCanvas.vue`。
- 接受选择 / 缩放状态下的右键 `pointerdown`，右键只进入平移分支。
- 通过 `pan-change: boolean` 通知父组件临时状态。
- 在 `pointerup`、`pointercancel`、`lostpointercapture` 和窗口失焦时清理状态并通知结束。
- 仅在画布内阻止 `contextmenu`，平移时显示抓取光标。

**步骤 3：工具栏反馈**

- 修改 `frontend/app/components/OfficeCanvas/SpaceReview.vue`。
- 使用 `temporaryPanning` 接收 `pan-change`，不修改真实 `tool`。
- 临时平移时高亮“拖动画布”、取消“选择 / 缩放”高亮；结束后恢复。
- 更新操作提示，说明右键拖动和松开返回。

**步骤 4：验证与记录**

- 在 `frontend/` 执行 `pnpm build`。
- 执行 `node scripts/e2e-overview-canvas-controls.mjs`；本机缺少默认浏览器时设置现有 Chromium 的 `PLAYWRIGHT_EXECUTABLE_PATH`。
- 可补充执行 `pnpm e2e:space-review`，但其旧 mock 前置失败不得记为本功能回归通过。
- 检查 `git diff --check`，记录真实结果；失败或未运行项不得标为通过。

## 验证记录

- RED：2026-11-17 在原实现上运行专项 Playwright，页面成功进入空间总览，右键按下后等待“拖动画布”高亮在 3 秒后超时，符合功能缺失的预期失败。
- GREEN：实现后 `pnpm -C frontend build` 通过；同一专项脚本通过，覆盖 1 → 2 → 1 工具高亮、90 × 45 屏幕像素平移、从选中空间名称标签启动右键平移、松开不回弹、右键菜单限制、选中状态与反算到底图源坐标的几何不变、`pointercancel`、窗口失焦后再次拖动，以及 Alt + 滚轮缩放。
- 独立只读审查发现标签 `pointerdown` 无条件阻止冒泡的 Important 缺口；新增标签起点用例先在原实现超时，再将阻止冒泡限定为左键，构建、专项和工作流回归均通过。审查无 Critical 问题。
- 用户实际截图出现蓝色轨迹和“无效手势”，且工具栏已临时切到“拖动画布”。据此补外层手势监听回归：原实现会收到 `pointerdown/pointermove/pointerup/contextmenu`，现将临时右键平移事件限制在空间画布内并继续阻止右键菜单。新增断言先失败后通过；构建、专项、`e2e:workflows` 和 `git diff --check` 通过。该结果验证页面事件隔离，不等于用户浏览器原生鼠标手势已实测消失。
- 构建仍有既有重复自动导入和大 chunk 警告，本任务未处理。
- `pnpm -C frontend e2e:space-review` 已运行但仍失败：旧 mock 使页面显示“当前账号暂无可访问项目”，在原第 106 行等待空间画布超时，未进入本功能用例；不记为通过，也未在本任务扩大范围修复旧套件。
- 最终再次执行生产构建、专项 Playwright 和 `git diff --check`，均通过；`pnpm -C frontend e2e:workflows` 模拟工作流回归也通过。
- 验证使用模拟 API 和生产构建预览，不是真实识别或业务验收。

## 未覆盖项

- 普通滚轮改为上下平移、Shift + 滚轮左右平移不在本次已确认范围内。
- 家具排版画布、触摸手势和后端接口不在本次范围内。
- 审查 Minor 后续项：活动手势中的 `lostpointercapture` 独立断言、Alt + 滚轮的鼠标锚点不变断言、带已确认 mock 的复核状态不变断言；这些项目前未单独覆盖，不声称已验证。
