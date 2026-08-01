import SwiftUI
import WebKit

@MainActor
final class ReceiverModel: ObservableObject {
    @Published var status = "点击开始接收后启用摄像头"
    @Published var cameraReady = false
    @Published var decoderReady = false
    @Published var hasError = false
    @Published var selectedMode = "B"
    @Published var captured = 0
    @Published var submitted = 0
    @Published var decoded = 0
    @Published var noData = 0
    @Published var rejected = 0
    @Published var errors = 0
    @Published var inFlight = 0
    @Published var captureFPS = 0.0
    @Published var submitFPS = 0.0
    @Published var decodeFPS = 0.0
    @Published var decodedBytes = 0
    @Published var transferRate = 0.0
    @Published var dropped = 0
    @Published var roiWidth = 0
    @Published var roiHeight = 0
    @Published var pixelFormat = "--"
    @Published var cameraProfile = "清晰"
    @Published var progress = 0.0
    @Published var completedName: String?
    @Published var completedBytes = 0
    @Published var isRunning = false
    fileprivate var sessionStartedAt = Date()
    fileprivate var rateSamples: [(Date, Int)] = []

    func beginSession() {
        status = "正在启动本地解码器…"
        cameraReady = false; decoderReady = false; hasError = false; isRunning = true
        captured = 0; submitted = 0; decoded = 0; noData = 0; rejected = 0; errors = 0; inFlight = 0
        captureFPS = 0; submitFPS = 0; decodeFPS = 0; decodedBytes = 0; progress = 0
        completedName = nil; completedBytes = 0
        transferRate = 0; sessionStartedAt = Date()
        rateSamples = []
        dropped = 0; roiWidth = 0; roiHeight = 0; pixelFormat = "--"; cameraProfile = "清晰"
    }

    func endSession() {
        isRunning = false; cameraReady = false
        status = "接收已结束 · 点击开始可开启新一轮"
    }
}

struct CimbarReceiverWebView: UIViewRepresentable {
    @ObservedObject var model: ReceiverModel
    @Binding var downloadedFile: URL?

    func makeCoordinator() -> Coordinator { Coordinator(model: model, downloadedFile: $downloadedFile) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "nativeStatus")
        controller.addUserScript(WKUserScript(source: """
          window.addEventListener('message', e => {
            if (e.data && e.data.source === 'qrrec-color')
              window.webkit.messageHandlers.nativeStatus.postMessage(e.data);
          });
          window.addEventListener('unhandledrejection', e =>
            window.webkit.messageHandlers.nativeStatus.postMessage({type:'runtime-error', reason:String(e.reason)}));
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.uiDelegate = context.coordinator
        web.navigationDelegate = context.coordinator
        context.coordinator.webView = web
        guard let server = LocalWebServer() else {
            model.status = "找不到内置 libcimbar 运行时"
            model.hasError = true
            return web
        }
        context.coordinator.server = server
        server.start { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let page): web.load(URLRequest(url: page))
                case .failure(let error):
                    model.status = error.localizedDescription
                    model.hasError = true
                }
            }
        }
        return web
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.lastMode != model.selectedMode else { return }
        context.coordinator.lastMode = model.selectedMode
        let mode = model.selectedMode.replacingOccurrences(of: "'", with: "")
        webView.evaluateJavaScript("window.QRRECV5?.setMode('\(mode)')")
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.evaluateJavaScript("Recv?.stop?.()")
        webView.stopLoading()
        coordinator.server?.stop()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nativeStatus")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
        let model: ReceiverModel
        var downloadedFile: Binding<URL?>
        weak var webView: WKWebView?
        var pendingDownloadURL: URL?
        var server: LocalWebServer?
        var lastMode: String?

        init(model: ReceiverModel, downloadedFile: Binding<URL?>) {
            self.model = model; self.downloadedFile = downloadedFile
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let info = message.body as? [String: Any], let type = info["type"] as? String else { return }
            Task { @MainActor in
                switch type {
                case "runtime-ready": self.model.decoderReady = true; self.model.status = "解码器已就绪，正在申请后置相机"
                case "camera-ready":
                    self.model.cameraReady = true
                    let w = info["width"] as? Int ?? 0, h = info["height"] as? Int ?? 0
                    self.model.status = "相机 \(w)×\(h) · 等待彩色光码"
                case "pipeline-stats":
                    self.model.captured = Self.int(info["captured"])
                    self.model.submitted = Self.int(info["submitted"])
                    self.model.decoded = Self.int(info["decoded"])
                    self.model.noData = Self.int(info["noData"])
                    self.model.rejected = Self.int(info["rejected"])
                    self.model.errors = Self.int(info["errors"])
                    self.model.inFlight = Self.int(info["inFlight"])
                    self.model.captureFPS = Self.double(info["captureFps"])
                    self.model.submitFPS = Self.double(info["submitFps"])
                    self.model.decodeFPS = Self.double(info["decodeFps"])
                    self.model.dropped = Self.int(info["dropped"])
                    self.model.roiWidth = Self.int(info["roiWidth"])
                    self.model.roiHeight = Self.int(info["roiHeight"])
                    self.model.pixelFormat = info["pixelFormat"] as? String ?? "--"
                    self.model.cameraProfile = info["cameraProfile"] as? String ?? "清晰"
                    if self.model.decoded > 0 { self.model.status = "已识别光码，正在接收文件…" }
                    else if self.model.noData > 0 { self.model.status = "已定位矩阵，正在提取有效数据…" }
                    else if self.model.rejected > 0 { self.model.status = "正在扫描画面 · 请保持四角完整清晰" }
                case "decoded-frame":
                    let bytes = Self.int(info["bytes"])
                    let now = Date()
                    self.model.decodedBytes += bytes
                    self.model.rateSamples.append((now, bytes))
                    self.model.rateSamples.removeAll { now.timeIntervalSince($0.0) > 5 }
                    let elapsed = max(min(5, now.timeIntervalSince(self.model.sessionStartedAt)), 1)
                    self.model.transferRate = Double(self.model.rateSamples.reduce(0) { $0 + $1.1 }) / elapsed
                    self.model.status = "正在接收文件…"
                case "progress":
                    let values = (info["values"] as? [NSNumber])?.map(\.doubleValue) ?? []
                    self.model.progress = values.max() ?? self.model.progress
                case "complete":
                    self.model.completedName = info["name"] as? String ?? "接收文件"
                    self.model.completedBytes = Self.int(info["bytes"])
                    self.model.progress = 1
                    self.model.isRunning = false
                    self.model.cameraReady = false
                    self.model.status = "文件接收完成 · 可预览并保存"
                case "runtime-error":
                    self.model.hasError = true
                    self.model.isRunning = false
                    self.model.cameraReady = false
                    self.model.status = "解码失败：\(info["reason"] ?? "未知错误")"
                default: break
                }
            }
        }

        private static func int(_ value: Any?) -> Int { (value as? NSNumber)?.intValue ?? 0 }
        private static func double(_ value: Any?) -> Double { (value as? NSNumber)?.doubleValue ?? 0 }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.status = "页面已加载，正在初始化 libcimbar…"
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            model.hasError = true
            model.status = "解码页面加载失败：\(error.localizedDescription)"
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            model.hasError = true
            model.status = "本地服务连接失败：\(error.localizedDescription)"
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) { decisionHandler(.grant) }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     preferences: WKWebpagePreferences, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
            if action.shouldPerformDownload { decisionHandler(.download, preferences) }
            else { decisionHandler(.allow, preferences) }
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                      suggestedFilename: String) async -> URL? {
            let clean = suggestedFilename.replacingOccurrences(of: "/", with: "_")
            let destination = FileManager.default.temporaryDirectory.appendingPathComponent(clean)
            try? FileManager.default.removeItem(at: destination)
            pendingDownloadURL = destination
            return destination
        }

        func downloadDidFinish(_ download: WKDownload) {
            Task { @MainActor in
                self.model.status = "文件接收完成"
                self.downloadedFile.wrappedValue = self.pendingDownloadURL
            }
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            Task { @MainActor in self.model.hasError = true; self.model.status = "文件保存失败：\(error.localizedDescription)" }
        }
    }
}
