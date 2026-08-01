# QRREC V5.1 原生 iOS 接收端

V5.1 与 V5 分开维护。V5 已恢复到优化前约 40 KB/s 的 WASM 接收方案；V5.1 将接收链路替换为：

`AVFoundation 1080p NV12 -> libcimbar C++ / OpenCV -> fountain decoder -> App 内预览与手动保存`

V5.1 不包含 WKWebView、JavaScript 或 WASM 解码器。相机只在点击“开始接收”后开启，结束、完成或离开页面时关闭。

## 首次准备

OpenCV iOS framework 和编译产物体积较大，位于被 Git 忽略的 `Dependencies/`。首次克隆后运行：

```bash
cd v5.1
./scripts/prepare_native_ios.sh
open ios/OpticalReceiverV51/OpticalReceiverV51.xcodeproj
```

需要 Xcode 26、CMake，以及真机 arm64。当前最低系统版本为 iOS 16。

## 性能策略

- AVFoundation 直接输出 NV12，避免 WebView、Canvas、RGBA 和 JS/WASM 之间的多次复制。
- 相机目标 15 FPS；解码来不及时由 `alwaysDiscardsLateVideoFrames` 丢弃旧帧，优先处理最新画面。
- 解码在独立的高优先级串行队列运行，避免 libcimbar 喷泉码全局状态发生并发竞争。
- UI 展示采集 FPS、解码 FPS、接收速率、成功帧、未定位和无数据，文件完成后先由系统预览/分享面板交给用户决定保存位置。

上游 libcimbar 源码随 V5.1 一并保存在 `native/libcimbar`，保留 MPL-2.0 许可证。
