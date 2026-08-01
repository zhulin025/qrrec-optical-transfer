# Decimen 光码工具：小红书适配说明

## 产品拆分

### 光码发送器

- 名称：光码发送器
- 一句话描述：把本地文件变成动态二维码，通过屏幕直接发送给另一台设备。
- 类目建议：效率工具 / 文件工具
- 关键词：二维码传文件、离线传输、文件发送、光码、隐私工具、跨设备
- 网络与隐私：运行时不联网、不上传文件；文件仅在当前设备内存中编码并显示。

使用步骤：

1. 选择本地文件。
2. 保持动态二维码完整显示并调高亮度。
3. 在另一台设备打开 `https://qrrec.liuwa.xyz`。
4. 开启摄像头并对准二维码，完成后保存文件。

### 接收能力检测

- 名称：光码接收能力检测
- 一句话描述：检测小红书小工具环境是否支持安全上下文、实时摄像头和原生二维码识别。
- 类目建议：开发工具 / 效率工具
- 关键词：摄像头检测、二维码检测、WebView、能力检测、光码
- 网络与隐私：不联网、不上传画面；摄像头仅在本机短暂开启，15 秒后自动关闭。

此包是平台能力验证包，不代表完整接收器。为了保持上传包符合保守平台基线，第一版只检测
安全上下文、摄像头和原生二维码识别；Worker 和 WASM 不放入上传包。

### 完整光码接收器（优先测试版）

- 名称：光码接收器
- 一句话描述：使用摄像头扫描动态光码，在本地重组并保存原始文件。
- 实际能力：安全上下文、连续摄像头、Web Worker、ZXing WebAssembly、LT 喷泉解码、文件保存。
- 包内状态栏：安全环境、摄像头、Worker、WASM 四项。

这个版本按“完整功能优先、失败后再降级”的策略制作。Worker 和 WASM 只有在真实解码
Worker 启动且 941 KB ZXing 模块初始化成功后才会显示通过。由于它主动覆盖了保守平台
基线中的 Worker/WASM 限制，能否上传及运行必须由小红书真实容器验证。

## 构建与验证

```bash
npm install
npm run build:release
node scripts/build_xhs_package.mjs release/xhs-sender
node scripts/build_xhs_package.mjs xhs-receiver-probe
npm run build:receiver:xhs
node scripts/build_xhs_package.mjs release/xhs-receiver-full
npm run build:receiver:xhs:inline
node scripts/build_xhs_package.mjs release/xhs-receiver-main-thread-wasm
```

正式网页接收端构建输出为 `release/web-receiver/`。

## 包内容

- 发送器 ZIP：`release/xhs-sender/decimen-xhs-sender.zip`
- 能力检测 ZIP：`xhs-receiver-probe/decimen-xhs-receiver-probe.zip`
- 完整接收器 ZIP：`release/xhs-receiver-full/decimen-xhs-receiver-full.zip`
- 主线程 WASM 接收器 ZIP：`release/xhs-receiver-main-thread-wasm/decimen-xhs-receiver-main-thread-wasm.zip`
- 图标源文件：`assets/optical-tool-icon.svg`
- 移动端预览：`release/previews/`

发送器 ZIP 的 `index.html` 位于根目录，所有脚本和样式均为本地文件。能力检测包同样完全
离线，但由于测试目标本身包括受限 API，应以真实上传和真机检测结果为准。

## 协议决定

原始 PoC 只发送两张内置 PNG。适配版本新增通用文件信封，包含 UTF-8 文件名、MIME 类型
和文件长度，再将完整信封送入原 LT 喷泉码编码。网页接收器使用相同协议恢复原文件。

## 已知限制

- 光学吞吐量远低于网络传输，大文件耗时较长。
- 发送设备需要保持页面前台、屏幕常亮且亮度较高。
- 网页接收端依赖 HTTPS、摄像头权限、Web Worker 与 ZXing WASM。
- 完整性校验沿用原项目的 FNV-1a，仅用于发现传输错误，不是密码学认证。
- 小红书能力检测包必须在平台真实容器中复核；本地浏览器结果不能替代平台结论。

## 当前构建记录

- 发送器 ZIP SHA-256：`319ded33eb3ba46fffa8c27bcd74cd852b7b303a1c78f98e24d1aae90ef59a58`
- 能力检测 ZIP SHA-256：`156274f6d324687be9aa34ba6409aef79885f64a84c749ad935efb7e9fd29f96`
- 完整接收器 ZIP SHA-256：`b866e73cbc0b9abe78c3a33daa04362eece6f44abc200ecf3ba23cac7274fa38`
- 主线程 WASM 接收器 ZIP SHA-256：`ae9225a7c8832e418c478049f899e6a3b488f2025a598bb9ef59ab5297a0dc56`
- 正式网页接收端：`https://qrrec.vercel.app`
- 目标域名：`https://qrrec.liuwa.xyz`

`qrrec.liuwa.xyz` 已绑定到 Vercel `qrrec` 生产项目，并已验证返回最新四项能力界面。
