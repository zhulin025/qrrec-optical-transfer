import AVKit
import Photos
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ReceiverView: View {
    @StateObject private var model = ReceiverModel()
    @State private var shareURL: URL?
    @State private var receivedURL: URL?
    @State private var hasSession = false
    @State private var sessionID = UUID()
    @State private var mediaSaveStatus: String?
    @State private var isSavingMedia = false

    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.043, blue: 0.063).ignoresSafeArea()
            VStack(spacing: 12) {
                VStack(spacing: 5) {
                    Text("QRREC V5.4 · ADAPTIVE VIEWFINDER")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(2.1).foregroundStyle(Color(red: 1, green: 0.36, blue: 0.44))
                    Text("高速光码接收器 V5.4")
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
                        mediaSaveStatus = nil
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
                        Image(systemName: mediaKind(for: receivedURL)?.icon ?? "doc.fill").font(.title2).foregroundStyle(Color(red: 0.38, green: 0.87, blue: 0.63))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.completedName ?? receivedURL.lastPathComponent).font(.subheadline.bold()).lineLimit(1)
                            Text("已在 App 内接收 · \(byteText(model.completedBytes))").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if mediaKind(for: receivedURL) != nil {
                            Button(isSavingMedia ? "保存中…" : "保存到相册") { saveMediaToPhotos(receivedURL) }
                                .buttonStyle(.borderedProminent).disabled(isSavingMedia)
                        } else {
                            Button("导出") { shareURL = receivedURL }.buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(10).background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 12))

                    if let mediaSaveStatus {
                        Text(mediaSaveStatus)
                            .font(.caption.bold())
                            .foregroundStyle(mediaSaveStatus.contains("成功") ? Color(red: 0.38, green: 0.87, blue: 0.63) : Color(red: 1, green: 0.72, blue: 0.42))
                    }
                }

                if model.isRunning {
                    HStack(spacing: 8) {
                        Image(systemName: model.isOptimalPosition ? "checkmark.circle.fill" : "viewfinder.circle")
                        Text(model.positionMessage)
                    }
                    .font(.caption.bold())
                    .foregroundStyle(model.isOptimalPosition ? Color.black : Color.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9).padding(.horizontal, 12)
                    .background(
                        model.isOptimalPosition ? Color(red: 0.42, green: 1, blue: 0.62) : Color.white.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 11)
                    )
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(model.isOptimalPosition ? Color.white.opacity(0.8) : Color.white.opacity(0.1)))
                }

                ZStack {
                    if let receivedURL, mediaKind(for: receivedURL) != nil {
                        receivedMediaPreview(receivedURL)
                    } else if hasSession {
                        CimbarReceiverWebView(model: model, downloadedFile: $receivedURL)
                            .aspectRatio(1, contentMode: .fit)
                            .id(sessionID)
                        if model.isRunning {
                            AdaptiveScanGuide(
                                scale: model.guideScale,
                                quality: model.guideQuality,
                                isOptimal: model.isOptimalPosition,
                                message: model.guideMessage
                            )
                            .allowsHitTesting(false)
                        }
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

                Text("正方形预览就是实际识别区域；连续 1 秒达到 100 KB/s 或有效解码 14 FPS，辅助框就会变绿并提示保持不动。")
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

    private func mediaKind(for url: URL) -> MediaKind? {
        guard let type = UTType(filenameExtension: url.pathExtension) else { return nil }
        if type.conforms(to: .image) { return .image }
        if type.conforms(to: .movie) || type.conforms(to: .video) { return .video }
        return nil
    }

    @ViewBuilder
    private func receivedMediaPreview(_ url: URL) -> some View {
        switch mediaKind(for: url) {
        case .image:
            if let image = UIImage(contentsOfFile: url.path) {
                Image(uiImage: image)
                    .resizable().scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)
            }
        case .video:
            ReceivedVideoPlayer(url: url)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case nil:
            EmptyView()
        }
    }

    private func saveMediaToPhotos(_ url: URL) {
        guard let kind = mediaKind(for: url) else { return }
        isSavingMedia = true
        mediaSaveStatus = nil
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async {
                    isSavingMedia = false
                    mediaSaveStatus = "没有相册写入权限，请在系统设置中允许添加照片"
                }
                return
            }
            PHPhotoLibrary.shared().performChanges {
                switch kind {
                case .image: PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url)
                case .video: PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
                }
            } completionHandler: { success, error in
                DispatchQueue.main.async {
                    isSavingMedia = false
                    mediaSaveStatus = success ? "已成功保存到系统相册" : "保存失败：\(error?.localizedDescription ?? "未知错误")"
                }
            }
        }
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

private enum MediaKind {
    case image, video
    var icon: String { self == .image ? "photo.fill" : "play.rectangle.fill" }
}

private struct ReceivedVideoPlayer: View {
    let url: URL
    @State private var player: AVPlayer

    init(url: URL) {
        self.url = url
        _player = State(initialValue: AVPlayer(url: url))
    }

    var body: some View {
        VideoPlayer(player: player)
            .background(Color.black)
            .onDisappear { player.pause() }
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

private struct AdaptiveScanGuide: View {
    let scale: Double
    let quality: Double
    let isOptimal: Bool
    let message: String

    private var guideColor: Color {
        if isOptimal { return Color(red: 0.42, green: 1, blue: 0.62) }
        if quality >= 0.30 { return Color(red: 1, green: 0.72, blue: 0.42) }
        return Color(red: 1, green: 0.36, blue: 0.44)
    }

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height) * CGFloat(scale)
            let origin = CGPoint(x: (geo.size.width - side) / 2, y: (geo.size.height - side) / 2)
            let frame = CGRect(origin: origin, size: CGSize(width: side, height: side))
            let corner = min(CGFloat(34), side * 0.12)

            ZStack {
                Path { path in
                    path.move(to: .init(x: frame.minX, y: frame.minY + corner)); path.addLine(to: frame.origin); path.addLine(to: .init(x: frame.minX + corner, y: frame.minY))
                    path.move(to: .init(x: frame.maxX - corner, y: frame.minY)); path.addLine(to: .init(x: frame.maxX, y: frame.minY)); path.addLine(to: .init(x: frame.maxX, y: frame.minY + corner))
                    path.move(to: .init(x: frame.maxX, y: frame.maxY - corner)); path.addLine(to: .init(x: frame.maxX, y: frame.maxY)); path.addLine(to: .init(x: frame.maxX - corner, y: frame.maxY))
                    path.move(to: .init(x: frame.minX + corner, y: frame.maxY)); path.addLine(to: .init(x: frame.minX, y: frame.maxY)); path.addLine(to: .init(x: frame.minX, y: frame.maxY - corner))
                }
                .stroke(guideColor, style: .init(lineWidth: isOptimal ? 5 : 3, lineCap: .round))
                .shadow(color: guideColor.opacity(0.8), radius: isOptimal ? 12 : 3)

                Text(message)
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.black.opacity(0.72), in: Capsule())
                    .overlay(Capsule().stroke(guideColor.opacity(0.8)))
                    .position(x: geo.size.width / 2, y: max(18, frame.minY - 18))
            }
            .animation(.easeOut(duration: 0.35), value: scale)
            .animation(.easeOut(duration: 0.25), value: quality)
        }
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension URL: @retroactive Identifiable { public var id: String { absoluteString } }
