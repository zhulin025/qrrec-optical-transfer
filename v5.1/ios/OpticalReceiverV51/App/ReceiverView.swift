import SwiftUI
import UIKit

struct ReceiverView: View {
    @StateObject private var model = ReceiverModel()
    @State private var shareURL: URL?
    @State private var receivedURL: URL?
    @State private var hasSession = false
    @State private var sessionID = UUID()

    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.043, blue: 0.063).ignoresSafeArea()
            VStack(spacing: 12) {
                VStack(spacing: 5) {
                    Text("QRREC V5.1 · NATIVE C++ RECEIVER")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(2.1).foregroundStyle(Color(red: 1, green: 0.36, blue: 0.44))
                    Text("高速光码接收器 V5.1")
                        .font(.system(size: 29, weight: .bold, design: .rounded))
                    Text("AVFoundation · C++ libcimbar · 原生喷泉码")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)

                HStack(spacing: 7) {
                    capability("相机", model.cameraReady)
                    capability("解码器", model.decoderReady)
                    capability("常亮", true)
                }

                Text(model.status)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(model.hasError ? Color.red : Color(red: 1, green: 0.72, blue: 0.42))
                    .lineLimit(2).multilineTextAlignment(.center)

                Picker("识别模式", selection: $model.selectedMode) {
                    ForEach(["B", "Bm", "Bu", "4C", "Auto"], id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                    metric("采集", String(format: "%.1f FPS", model.captureFPS))
                    metric("处理", String(format: "%.1f FPS", model.processFPS), good: model.processFPS >= 15)
                    metric("有效解码", String(format: "%.1f FPS", model.decodeFPS), good: model.decodeFPS >= 13)
                    metric("处理中", "\(model.inFlight)")
                    metric("接收速率", rateText(model.transferRate), good: model.transferRate > 0)
                    metric("成功帧", "\(model.decoded)", good: model.decoded > 0)
                    metric("已收数据", byteText(model.decodedBytes), good: model.decodedBytes > 0)
                    metric("文件进度", "\(Int(model.progress * 100))%", good: model.progress > 0)
                    metric("采集帧", "\(model.captured)")
                    metric("未定位", "\(model.rejected)")
                    metric("无数据", "\(model.noData)")
                    metric("忙碌丢帧", "\(model.dropped)", bad: model.dropped > model.captured / 2)
                    metric("NV12→RGB", String(format: "%.1f ms", model.convertMS))
                    metric("定位/校正", String(format: "%.1f ms", model.locateMS))
                    metric("码元解码", String(format: "%.1f ms", model.symbolMS))
                    metric("定位缓存", String(format: "%.0f%%", model.cacheHitRate * 100), good: model.cacheHitRate > 0.5)
                }

                if model.progress > 0 && model.progress < 1 {
                    ProgressView(value: model.progress) {
                        Text("文件接收进度 \(Int(model.progress * 100))%")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    .tint(Color(red: 0.38, green: 0.87, blue: 0.63))
                }

                Button {
                    if model.isRunning {
                        model.endSession()
                        hasSession = false
                    } else {
                        model.beginSession()
                        receivedURL = nil
                        sessionID = UUID()
                        hasSession = true
                    }
                } label: {
                    Label(model.isRunning ? "结束接收" : "开始接收", systemImage: model.isRunning ? "stop.fill" : "camera.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SessionButtonStyle(running: model.isRunning))

                if let receivedURL {
                    HStack(spacing: 12) {
                        Image(systemName: "doc.fill").font(.title2).foregroundStyle(Color(red: 0.38, green: 0.87, blue: 0.63))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.completedName ?? receivedURL.lastPathComponent).font(.subheadline.bold()).lineLimit(1)
                            Text("已在 App 内接收 · \(byteText(model.completedBytes))").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("保存") { shareURL = receivedURL }.buttonStyle(.borderedProminent)
                    }
                    .padding(10).background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 12))
                }

                ZStack {
                    if hasSession {
                        CimbarReceiverWebView(model: model, downloadedFile: $receivedURL)
                            .id(sessionID)
                        if model.isRunning { ScanCorners().padding(34).allowsHitTesting(false) }
                    } else {
                        VStack(spacing: 12) {
                            Image(systemName: "camera.viewfinder").font(.system(size: 44)).foregroundStyle(.secondary)
                            Text("摄像头尚未开启").font(.headline)
                            Text("点击“开始接收”后才会启用相机与解码器")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.1)))
                .shadow(color: .black.opacity(0.45), radius: 28, y: 14)

                Text("将彩色矩阵完整放入取景框。文件接收完成后会先在 App 内预览，再由你选择保存或下载。")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .preferredColorScheme(.dark)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = model.isRunning }
        .onChange(of: model.isRunning) { running in UIApplication.shared.isIdleTimerDisabled = running }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .sheet(item: $shareURL) { ShareSheet(url: $0) }
    }

    private func metric(_ title: String, _ value: String, good: Bool = false, bad: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(bad ? Color.red : (good ? Color(red: 0.38, green: 0.87, blue: 0.63) : .white))
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(title).font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 6)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.07)))
    }

    private func byteText(_ bytes: Int) -> String {
        if bytes >= 1_048_576 { return String(format: "%.1f MB", Double(bytes) / 1_048_576) }
        if bytes >= 1_024 { return String(format: "%.1f KB", Double(bytes) / 1_024) }
        return "\(bytes) B"
    }

    private func rateText(_ bytesPerSecond: Double) -> String {
        if bytesPerSecond >= 1_048_576 { return String(format: "%.1f MB/s", bytesPerSecond / 1_048_576) }
        if bytesPerSecond >= 1_024 { return String(format: "%.1f KB/s", bytesPerSecond / 1_024) }
        return String(format: "%.0f B/s", bytesPerSecond)
    }

    private func capability(_ title: String, _ ready: Bool) -> some View {
        HStack(spacing: 5) {
            Circle().fill(ready ? Color(red: 0.38, green: 0.87, blue: 0.63) : .gray).frame(width: 7, height: 7)
            Text(title).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(Color.white.opacity(0.045), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.08)))
    }
}

private struct SessionButtonStyle: ButtonStyle {
    let running: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.bold()).padding(.vertical, 12)
            .foregroundStyle(.white)
            .background(running ? Color.red.opacity(configuration.isPressed ? 0.65 : 0.85) : Color(red: 1, green: 0.36, blue: 0.44).opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 13))
    }
}

private struct ScanCorners: View {
    var body: some View {
        GeometryReader { geo in
            Path { path in
                let w = geo.size.width, h = geo.size.height, d: CGFloat = 28
                path.move(to: .init(x: 0, y: d)); path.addLine(to: .zero); path.addLine(to: .init(x: d, y: 0))
                path.move(to: .init(x: w-d, y: 0)); path.addLine(to: .init(x: w, y: 0)); path.addLine(to: .init(x: w, y: d))
                path.move(to: .init(x: w, y: h-d)); path.addLine(to: .init(x: w, y: h)); path.addLine(to: .init(x: w-d, y: h))
                path.move(to: .init(x: d, y: h)); path.addLine(to: .init(x: 0, y: h)); path.addLine(to: .init(x: 0, y: h-d))
            }.stroke(Color(red: 1, green: 0.72, blue: 0.42), style: .init(lineWidth: 3, lineCap: .round))
        }
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension URL: @retroactive Identifiable { public var id: String { absoluteString } }
