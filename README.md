# 折形 Reframe

在浏览器里重新塑造图片：内容感知缩放、区域保护、形状挤压与一键随机。经典 iOS 风格界面，适配桌面和手机。当前版本：**1.3.0**。

**[打开在线编辑器](https://hurrygoooodjob.github.io/reframe-editor/)**

图片处理、选区分析和导出均在浏览器中完成，无需账户或 API Key，应用不上传图片，也不调用云端模型。网页首次加载需要网络；[自包含 HTML](./docs/index.html) 下载后可离线使用。

## 使用

1. 打开图片，或使用内置示例。
2. 点击「一键随机挤压」，自动识别保护与压缩区域并生成缩放方案；也可「仅识别选区」后手动调整。
3. 用保护、压缩、擦除和矩形框选工具微调，再设置目标尺寸、内容感知强度、过渡柔和度和形状。
4. 对比原图，导出透明 PNG。需要继续编辑时保存 `.reframe.json` 工程；关闭页面前请保存，应用没有自动保存。

随机功能保留当前**形状、形状挤压强度和过渡柔和度**。重复随机以原图为基准，整组操作可以撤销。

## 功能

- 内容感知缩小与放大，支持 Forward Energy。
- 自动选区与手动涂抹；绿色保护主体，橙色标记优先压缩区域。
- 矩形、圆形、三角形、菱形、六边形、星形和心形；形状挤压 0% 为裁切，100% 将内容挤入轮廓。
- 坐标映射柔化，默认过渡柔和度 65%，保留原图采样细节。
- 30 步历史、原图对比、透明 PNG 导出、JSON 工程保存和恢复。
- 手机可收起设置面板、横向工具栏和横屏布局；单指涂抹与平移，按钮缩放。

## 手机与限制

使用现代手机浏览器打开部署后的 HTTPS 链接即可。早期 iOS 指视觉风格，不表示兼容 iOS 3/4。已针对窄屏和横屏布局验证；实际设备的触摸、软键盘和下载行为可能因浏览器而异。暂不支持双指缩放。

自动识别使用颜色、纹理和边界背景等启发式分析，不是语义分割或人脸识别。区域保护是软约束，极端压缩、规则线条及密集主体仍可能失真；不包含生成式重构。高分辨率导出从原图采样，但接缝分析使用较小网格。

- 输入：浏览器可解码的 JPG、PNG、WebP、AVIF、GIF、BMP；最大 50 MiB、4000 万像素，动图按静态处理。
- 输出：单边 32–8192 像素，总计不超过 2400 万像素。
- 工程：最大 75 MiB，含原图、参数和选区；历史记录不随工程保存。

## 本地开发

需要 Node.js 22.12 或以上版本及 pnpm。依赖版本由 `pnpm-lock.yaml` 固定。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm dev
```

`pnpm dev` 自动生成嵌入 Worker 并启动本机开发页面。修改 `src/engine/` 后，重启开发服务，或执行 `node scripts/build.mjs --worker-only` 后刷新页面。

`pnpm build` 输出自包含的 `dist/index.html`；`pnpm preview` 打开构建结果。测试产物写入 `.tmp/`，不纳入版本控制。

## GitHub Pages

本仓库可直接使用 `main` 分支的 `/docs` 文件夹发布，无需后端服务器或自定义域名。

1. 在仓库 **Settings → Pages** 中选择 **Deploy from a branch**。
2. 选择 **main** 分支和 **/docs** 文件夹，保存。
3. 等待 Pages 部署完成，使用设置页提供的站点链接访问。

修改源码后，重新生成发布文件并随源码一起提交：

```sh
pnpm build:pages
pnpm typecheck
pnpm test
```

`build:pages` 生成 `docs/index.html`、`.nojekyll` 和许可文件。HTML 内嵌依赖、样例图和 Worker，不依赖网站根路径，适合仓库子路径托管。部署目录见 [docs](./docs)。

## 项目结构

```text
src/          React + TypeScript 界面、状态与图像处理
src/engine/   内容感知缩放、自动选区、映射柔化及 Worker
src/assets/   带许可记录的内置示例
scripts/      构建、预览和测试入口
tests/        算法及随机行为回归测试
docs/         GitHub Pages 发布成品
```

## 许可

原创代码采用 [MIT License](./LICENSE)。内置示例照片与第三方依赖遵循各自许可，详见 [第三方声明](./THIRD_PARTY_NOTICES.md)。重新分发源码或离线版本时，请保留许可和声明。
