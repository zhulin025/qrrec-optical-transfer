import SwiftUI
import UIKit

struct ReceiverView: View {
    @StateObject private var model = ReceiverModel()
    @State private var shareURL: URL?

    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.043, blue: 0.063).ignoresSafeArea()
            VStack(spacing: 12) {
                VStack(spacing: 5) {
                    Text("QRREC V5 · NATIVE IOS RECEIVER")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(2.1).foregroundStyle(Color(red: 1, green: 0.36, blue: 0.44))
                    Text("高速光码接收器 V5")
                        .font(.system(size: 29, weight: .bold, design: .rounded))
                    Text("原生相机调度 · 4 路 WASM 解码 · libcimbar 喷泉码")
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

                ZStack {
                    CimbarReceiverWebView(model: model, downloadedFile: $shareURL)
                    ScanCorners().padding(34).allowsHitTesting(false)
                }
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.1)))
                .shadow(color: .black.opacity(0.45), radius: 28, y: 14)

                Text("将彩色矩阵完整放入取景框。收到文件后会自动打开系统分享面板。")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .preferredColorScheme(.dark)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .sheet(item: $shareURL) { ShareSheet(url: $0) }
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
