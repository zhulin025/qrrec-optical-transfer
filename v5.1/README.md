# QRREC V5.1 原生 iOS 接收端

V5.1 与 V5 分开维护。V5 已恢复到优化前约 40 KB/s 的 WASM 接收方案；V5.1 将接收链路替换为：

`AVFoundation 1080p NV12 -> libcimbar C++ / OpenCV -> fountain decoder -> App 内预览与手动保存`

V5.1 不包含 WKWebView、JavaScript 或 WASM 解码器。相机只在点击“开始接收”后开启，结束、完成或离开页面时关闭。

配套网页发送端为 `https://qrrec.liuwa.xyz/v5.1/send/`，默认 20 FPS。原 V5 发送端仍保持 15 FPS，两个版本互不改变默认性能参数。

## 首次准备

OpenCV iOS framework 和编译产物体积较大，位于被 Git 忽略的 `Dependencies/`。首次克隆后运行：

```bash
cd v5.1
./scripts/prepare_native_ios.sh
open ios/OpticalReceiverV51/OpticalReceiverV51.xcodeproj
```

需要 Xcode 26、CMake，以及真机 arm64。当前最低系统版本为 iOS 16。

## 性能策略

- AVFoundation 优先选择 1080p/60 FPS 格式并输出 NV12；设备不支持时回退 30 FPS。CVPixelBuffer 的 Y/UV 双平面及 stride 直接传给 C++，不再为每帧申请并复制一份连续 NV12 数组。
- 三个独立 C++ worker 各自持有 OpenCV 缓冲区、码元 Decoder 和透视矩阵，扫描/校正/码元解码可并行运行；喷泉码状态合并仍在单独串行队列完成。
- 首次定位四个锚点后缓存透视矩阵，普通帧直接校正；每 8 个 worker 帧定期重新定位，连续缓存解码失败时提前重新定位，以兼顾手持移动和吞吐量。
- worker 忙碌时丢弃旧帧并优先获取最新画面。相机使用 30 FPS 是为了降低与 15 FPS 发送画面相位同步时持续采到过渡帧的概率，不代表所有采集帧都要解码。
- UI 展示采集/处理/有效解码 FPS、接收速率、忙碌丢帧、NV12 转 RGB、定位/校正、码元解码和定位缓存命中率，便于直接定位真机瓶颈。
- 文件完成后留在 App 内，由用户点击“保存”再打开系统分享面板。

libcimbar 的持续传输基准约为 106 KB/s（模式 B），其测试条件使用 15 FPS 发送和 4 个 CPU 解码线程。V5.1 的理论有效载荷约为每帧 7.5 KB，因此达到 100 KB/s 需要稳定取得约 14 个有效帧/秒；实际结果仍取决于屏幕刷新、曝光、对焦、拍摄角度和发送端画面是否完整。

上游 libcimbar 源码随 V5.1 一并保存在 `native/libcimbar`，保留 MPL-2.0 许可证。
