import AVFoundation
import SwiftUI
import UIKit

@_silgen_name("cimbard_configure_decode") private func cimbarConfigure(_ mode: Int32) -> Int32
@_silgen_name("cimbard_reset_decode") private func cimbarReset()
@_silgen_name("cimbard_get_bufsize") private func cimbarBufferSize() -> Int32
@_silgen_name("cimbard_scan_extract_decode") private func cimbarScan(_ image: UnsafePointer<UInt8>, _ width: UInt32, _ height: UInt32, _ format: Int32, _ output: UnsafeMutablePointer<UInt8>, _ size: UInt32) -> Int32
@_silgen_name("cimbard_fountain_decode") private func cimbarFountain(_ data: UnsafePointer<UInt8>, _ size: UInt32) -> Int64
@_silgen_name("cimbard_get_filename") private func cimbarFilename(_ id: UInt32, _ name: UnsafeMutablePointer<CChar>, _ size: UInt32) -> Int32
@_silgen_name("cimbard_get_decompress_bufsize") private func cimbarDecompressSize() -> Int32
@_silgen_name("cimbard_decompress_read") private func cimbarDecompress(_ id: UInt32, _ output: UnsafeMutablePointer<UInt8>, _ size: UInt32) -> Int32
@_silgen_name("cimbard_get_report") private func cimbarReport(_ output: UnsafeMutablePointer<UInt8>, _ size: UInt32) -> UInt32

@MainActor
final class ReceiverModel: ObservableObject {
    @Published var status = "点击开始接收后启用摄像头"
    @Published var cameraReady = false
    @Published var decoderReady = true
    @Published var hasError = false
    @Published var selectedMode = "B"
    @Published var captured = 0
    @Published var decoded = 0
    @Published var noData = 0
    @Published var rejected = 0
    @Published var errors = 0
    @Published var inFlight = 0
    @Published var captureFPS = 0.0
    @Published var decodeFPS = 0.0
    @Published var decodedBytes = 0
    @Published var transferRate = 0.0
    @Published var progress = 0.0
    @Published var completedName: String?
    @Published var completedBytes = 0
    @Published var isRunning = false
    fileprivate var sessionStartedAt = Date()

    func beginSession() {
        status = "正在启动原生 AVFoundation 相机…"
        cameraReady = false; decoderReady = true; hasError = false; isRunning = true
        captured = 0; decoded = 0; noData = 0; rejected = 0; errors = 0; inFlight = 0
        captureFPS = 0; decodeFPS = 0; decodedBytes = 0; progress = 0
        completedName = nil; completedBytes = 0; transferRate = 0; sessionStartedAt = Date()
    }

    func endSession() {
        isRunning = false; cameraReady = false
        status = "接收已结束 · 点击开始可开启新一轮"
    }
}

// The historical name is retained so the V5 UI can be reused unchanged; this
// view contains no web view or WASM. Frames go AVFoundation -> NV12 -> C++.
struct CimbarReceiverWebView: UIViewRepresentable {
    @ObservedObject var model: ReceiverModel
    @Binding var downloadedFile: URL?

    func makeCoordinator() -> NativeCameraCoordinator { NativeCameraCoordinator(model: model, file: $downloadedFile) }
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        context.coordinator.attach(view)
        context.coordinator.start()
        return view
    }
    func updateUIView(_ view: PreviewView, context: Context) {}
    static func dismantleUIView(_ view: PreviewView, coordinator: NativeCameraCoordinator) { coordinator.stop() }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

final class NativeCameraCoordinator: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let model: ReceiverModel
    private var file: Binding<URL?>
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "xyz.liuwa.qrrec.v51.decoder", qos: .userInteractive)
    private var outputBuffer = [UInt8]()
    private var startTime = CACurrentMediaTime()
    private var captureWindow = CACurrentMediaTime()
    private var decodeWindow = CACurrentMediaTime()
    private var captureWindowCount = 0
    private var decodeWindowCount = 0
    private var captured = 0
    private var decoded = 0
    private var decodedBytes = 0
    private var rejected = 0
    private var noData = 0
    private var errors = 0
    private var completed = false

    init(model: ReceiverModel, file: Binding<URL?>) { self.model = model; self.file = file }

    @MainActor func attach(_ view: PreviewView) {
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
    }

    func start() {
        queue.async { [self] in
            guard !session.isRunning else { return }
            completed = false; startTime = CACurrentMediaTime(); captureWindow = startTime; decodeWindow = startTime
            cimbarReset()
            _ = cimbarConfigure(68)
            outputBuffer = [UInt8](repeating: 0, count: Int(cimbarBufferSize()))
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: configureAndRun()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                    guard let self else { return }
                    self.queue.async { allowed ? self.configureAndRun() : self.fail("没有相机权限") }
                }
            default: fail("请在系统设置中允许相机权限")
            }
        }
    }

    func stop() { queue.async { [self] in if session.isRunning { session.stopRunning() } } }

    private func configureAndRun() {
        session.beginConfiguration()
        session.sessionPreset = .hd1920x1080
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else {
            session.commitConfiguration(); fail("无法打开后置相机"); return
        }
        session.addInput(input)
        if trySetFrameRate(camera, fps: 15) == false { /* device chooses its nearest supported rate */ }
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else { session.commitConfiguration(); fail("无法创建相机帧输出"); return }
        session.addOutput(output)
        if let connection = output.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            } else {
                connection.videoOrientation = .portrait
            }
        }
        session.commitConfiguration()
        session.startRunning()
        Task { @MainActor in
            model.cameraReady = true
            model.status = "原生相机 1080p · C++ 解码器已就绪"
        }
    }

    private func trySetFrameRate(_ camera: AVCaptureDevice, fps: Double) -> Bool {
        guard let range = camera.activeFormat.videoSupportedFrameRateRanges.first(where: { $0.minFrameRate <= fps && fps <= $0.maxFrameRate }) else { return false }
        do {
            try camera.lockForConfiguration()
            let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
            camera.activeVideoMinFrameDuration = duration; camera.activeVideoMaxFrameDuration = duration
            if camera.isFocusModeSupported(.continuousAutoFocus) { camera.focusMode = .continuousAutoFocus }
            if camera.isExposureModeSupported(.continuousAutoExposure) { camera.exposureMode = .continuousAutoExposure }
            camera.unlockForConfiguration(); _ = range; return true
        } catch { return false }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !completed, let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        captured += 1; captureWindowCount += 1
        let before = CACurrentMediaTime()
        CVPixelBufferLockBaseAddress(pixel, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixel, .readOnly) }
        let width = CVPixelBufferGetWidthOfPlane(pixel, 0), height = CVPixelBufferGetHeightOfPlane(pixel, 0)
        var nv12 = [UInt8](repeating: 0, count: width * height * 3 / 2)
        copyPlane(pixel, plane: 0, rows: height, rowBytes: width, destination: &nv12, offset: 0)
        copyPlane(pixel, plane: 1, rows: height / 2, rowBytes: width, destination: &nv12, offset: width * height)
        let scanResult = nv12.withUnsafeBufferPointer { input in
            outputBuffer.withUnsafeMutableBufferPointer { out in
                cimbarScan(input.baseAddress!, UInt32(width), UInt32(height), 12, out.baseAddress!, UInt32(out.count))
            }
        }
        if scanResult > 0 {
            decoded += 1; decodedBytes += Int(scanResult); decodeWindowCount += 1
            let fileID = outputBuffer.withUnsafeBufferPointer { cimbarFountain($0.baseAddress!, UInt32(scanResult)) }
            if fileID > 0 { finish(UInt32(fileID)); return }
        } else if scanResult == 0 { noData += 1 }
        else if scanResult == -3 { rejected += 1 }
        else { errors += 1 }
        publish(now: CACurrentMediaTime(), decodeDuration: CACurrentMediaTime() - before)
    }

    private func copyPlane(_ pixel: CVPixelBuffer, plane: Int, rows: Int, rowBytes: Int, destination: inout [UInt8], offset: Int) {
        guard let source = CVPixelBufferGetBaseAddressOfPlane(pixel, plane) else { return }
        let stride = CVPixelBufferGetBytesPerRowOfPlane(pixel, plane)
        destination.withUnsafeMutableBytes { raw in
            guard let dest = raw.baseAddress else { return }
            for row in 0..<rows { memcpy(dest.advanced(by: offset + row * rowBytes), source.advanced(by: row * stride), rowBytes) }
        }
    }

    private func publish(now: CFTimeInterval, decodeDuration: CFTimeInterval) {
        let captureElapsed = now - captureWindow
        let decodeElapsed = now - decodeWindow
        guard captureElapsed >= 0.5 else { return }
        let captureFPS = Double(captureWindowCount) / captureElapsed
        let decodeFPS = decodeElapsed > 0 ? Double(decodeWindowCount) / decodeElapsed : 0
        let rate = Double(decodedBytes) / max(now - startTime, 0.001)
        let progress = readProgress()
        captureWindow = now; decodeWindow = now; captureWindowCount = 0; decodeWindowCount = 0
        let c = captured, d = decoded, b = decodedBytes, r = rejected, n = noData, e = errors
        Task { @MainActor in
            model.captured = c; model.decoded = d; model.decodedBytes = b; model.rejected = r; model.noData = n; model.errors = e
            model.captureFPS = captureFPS; model.decodeFPS = decodeFPS; model.transferRate = rate; model.progress = max(model.progress, progress)
            if d > 0 { model.status = "正在接收文件…" } else if r > 0 { model.status = "正在扫描画面 · 请保持四角完整清晰" }
            model.inFlight = 0
        }
        _ = decodeDuration
    }

    private func readProgress() -> Double {
        var bytes = [UInt8](repeating: 0, count: 1024)
        let count = bytes.withUnsafeMutableBufferPointer { cimbarReport($0.baseAddress!, UInt32($0.count)) }
        guard count > 0, let text = String(bytes: bytes.prefix(Int(count)), encoding: .utf8) else { return 0 }
        return text.split(whereSeparator: { ",[] ".contains($0) }).compactMap { Double($0) }.max() ?? 0
    }

    private func finish(_ id: UInt32) {
        completed = true; session.stopRunning()
        var nameBuffer = [CChar](repeating: 0, count: 512)
        let nameLength = nameBuffer.withUnsafeMutableBufferPointer { cimbarFilename(id, $0.baseAddress!, UInt32($0.count - 1)) }
        let name = nameLength > 0 ? String(bytes: nameBuffer.prefix(Int(nameLength)).map { UInt8(bitPattern: $0) }, encoding: .utf8) ?? "接收文件" : "接收文件"
        let chunkSize = max(Int(cimbarDecompressSize()), 4096)
        var chunk = [UInt8](repeating: 0, count: chunkSize), data = Data()
        while true {
            let read = chunk.withUnsafeMutableBufferPointer { cimbarDecompress(id, $0.baseAddress!, UInt32($0.count)) }
            if read <= 0 { break }; data.append(contentsOf: chunk.prefix(Int(read)))
        }
        let safeName = name.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try data.write(to: url, options: .atomic)
            Task { @MainActor in
                model.completedName = safeName; model.completedBytes = data.count; model.progress = 1
                model.isRunning = false; model.cameraReady = false; model.status = "文件接收完成 · 可预览并保存"
                file.wrappedValue = url
            }
        } catch { fail("文件写入失败：\(error.localizedDescription)") }
    }

    private func fail(_ message: String) {
        Task { @MainActor in model.hasError = true; model.isRunning = false; model.cameraReady = false; model.status = message }
    }
}
