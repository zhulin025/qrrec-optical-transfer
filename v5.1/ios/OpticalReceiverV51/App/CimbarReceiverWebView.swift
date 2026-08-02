import AVFoundation
import SwiftUI
import UIKit

@_silgen_name("cimbard_configure_decode") private func cimbarConfigure(_ mode: Int32) -> Int32
@_silgen_name("cimbard_reset_decode") private func cimbarReset()
@_silgen_name("cimbard_get_bufsize") private func cimbarBufferSize() -> Int32
@_silgen_name("cimbard_worker_create") private func cimbarWorkerCreate() -> UnsafeMutableRawPointer?
@_silgen_name("cimbard_worker_destroy") private func cimbarWorkerDestroy(_ worker: UnsafeMutableRawPointer)
@_silgen_name("cimbard_worker_decode_nv12") private func cimbarWorkerDecode(
    _ worker: UnsafeMutableRawPointer,
    _ y: UnsafePointer<UInt8>, _ yStride: UInt32,
    _ uv: UnsafePointer<UInt8>, _ uvStride: UInt32,
    _ width: UInt32, _ height: UInt32,
    _ output: UnsafeMutablePointer<UInt8>, _ outputSize: UInt32,
    _ convertMS: UnsafeMutablePointer<Double>, _ locateMS: UnsafeMutablePointer<Double>,
    _ decodeMS: UnsafeMutablePointer<Double>, _ usedCache: UnsafeMutablePointer<Int32>
) -> Int32
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
    @Published var processed = 0
    @Published var decoded = 0
    @Published var noData = 0
    @Published var rejected = 0
    @Published var errors = 0
    @Published var dropped = 0
    @Published var inFlight = 0
    @Published var captureFPS = 0.0
    @Published var processFPS = 0.0
    @Published var decodeFPS = 0.0
    @Published var decodedBytes = 0
    @Published var transferRate = 0.0
    @Published var progress = 0.0
    @Published var convertMS = 0.0
    @Published var locateMS = 0.0
    @Published var symbolMS = 0.0
    @Published var cacheHitRate = 0.0
    @Published var completedName: String?
    @Published var completedBytes = 0
    @Published var isRunning = false

    func beginSession() {
        status = "正在启动原生 AVFoundation 相机…"
        cameraReady = false; decoderReady = true; hasError = false; isRunning = true
        captured = 0; processed = 0; decoded = 0; noData = 0; rejected = 0; errors = 0
        dropped = 0; inFlight = 0; captureFPS = 0; processFPS = 0; decodeFPS = 0
        decodedBytes = 0; transferRate = 0; progress = 0
        convertMS = 0; locateMS = 0; symbolMS = 0; cacheHitRate = 0
        completedName = nil; completedBytes = 0
    }

    func endSession() {
        isRunning = false; cameraReady = false
        status = "接收已结束 · 点击开始可开启新一轮"
    }
}

// The historical name is retained so the V5 UI can be reused. This view has
// no WKWebView or WASM: AVFoundation NV12 planes go straight into C++ workers.
struct CimbarReceiverWebView: UIViewRepresentable {
    @ObservedObject var model: ReceiverModel
    @Binding var downloadedFile: URL?

    func makeCoordinator() -> NativeCameraCoordinator {
        NativeCameraCoordinator(model: model, file: $downloadedFile, mode: model.selectedMode)
    }
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

private final class DecoderSlot: @unchecked Sendable {
    let queue: DispatchQueue
    let worker: UnsafeMutableRawPointer
    var output: [UInt8]
    var busy = false

    init?(index: Int, outputSize: Int) {
        guard let worker = cimbarWorkerCreate() else { return nil }
        self.worker = worker
        output = [UInt8](repeating: 0, count: outputSize)
        queue = DispatchQueue(label: "xyz.liuwa.qrrec.v51.worker.\(index)", qos: .userInteractive)
    }
    deinit { cimbarWorkerDestroy(worker) }
}

private final class PixelBufferBox: @unchecked Sendable {
    let value: CVPixelBuffer
    init(_ value: CVPixelBuffer) { self.value = value }
}

final class NativeCameraCoordinator: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private static let workerCount = 3
    private let model: ReceiverModel
    private var file: Binding<URL?>
    private let mode: Int32
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "xyz.liuwa.qrrec.v51.capture", qos: .userInteractive)
    private let fountainQueue = DispatchQueue(label: "xyz.liuwa.qrrec.v51.fountain", qos: .userInteractive)
    private let lock = NSLock()
    private var slots: [DecoderSlot] = []

    private var windowStartedAt = CACurrentMediaTime()
    private var windowCaptured = 0
    private var windowProcessed = 0
    private var windowDecoded = 0
    private var windowBytes = 0
    private var captured = 0
    private var processed = 0
    private var decoded = 0
    private var decodedBytes = 0
    private var rejected = 0
    private var noData = 0
    private var errors = 0
    private var dropped = 0
    private var inFlight = 0
    private var stageSamples = 0
    private var convertTotal = 0.0
    private var locateTotal = 0.0
    private var symbolTotal = 0.0
    private var cacheHits = 0
    private var completed = false

    init(model: ReceiverModel, file: Binding<URL?>, mode: String) {
        self.model = model
        self.file = file
        switch mode {
        case "4C": self.mode = 4
        case "Bu": self.mode = 66
        case "Bm": self.mode = 67
        default: self.mode = 68
        }
    }

    @MainActor func attach(_ view: PreviewView) {
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
    }

    func start() {
        captureQueue.async { [self] in
            guard !session.isRunning else { return }
            cimbarReset()
            _ = cimbarConfigure(mode)
            let outputSize = Int(cimbarBufferSize())
            slots = (0..<Self.workerCount).compactMap { DecoderSlot(index: $0, outputSize: outputSize) }
            guard slots.count == Self.workerCount else { fail("无法创建 C++ 解码工作线程"); return }
            resetMetrics()
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: configureAndRun()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                    guard let self else { return }
                    self.captureQueue.async { allowed ? self.configureAndRun() : self.fail("没有相机权限") }
                }
            default: fail("请在系统设置中允许相机权限")
            }
        }
    }

    func stop() {
        lock.withLock { completed = true }
        captureQueue.async { [self] in if session.isRunning { session.stopRunning() } }
    }

    private func resetMetrics() {
        lock.withLock {
            let now = CACurrentMediaTime()
            windowStartedAt = now
            windowCaptured = 0; windowProcessed = 0; windowDecoded = 0; windowBytes = 0
            captured = 0; processed = 0; decoded = 0; decodedBytes = 0
            rejected = 0; noData = 0; errors = 0; dropped = 0; inFlight = 0
            stageSamples = 0; convertTotal = 0; locateTotal = 0; symbolTotal = 0; cacheHits = 0
            completed = false
        }
    }

    private func configureAndRun() {
        session.beginConfiguration()
        session.sessionPreset = .hd1920x1080
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else {
            session.commitConfiguration(); fail("无法打开后置相机"); return
        }
        session.addInput(input)
        let configuredFPS = configureCamera(camera, targetFPS: 60)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        output.setSampleBufferDelegate(self, queue: captureQueue)
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
            model.status = "原生相机 1080p@\(Int(configuredFPS)) · 3 路 C++ 解码器已就绪"
        }
    }

    private func configureCamera(_ camera: AVCaptureDevice, targetFPS: Double) -> Double {
        let targetFormat = camera.formats.first { format in
            let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return size.width == 1920 && size.height == 1080 &&
                format.videoSupportedFrameRateRanges.contains(where: { $0.minFrameRate <= targetFPS && targetFPS <= $0.maxFrameRate })
        }
        do {
            try camera.lockForConfiguration()
            let fps: Double
            if let targetFormat {
                camera.activeFormat = targetFormat
                fps = targetFPS
            } else {
                let maximum = camera.activeFormat.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30
                fps = min(30, maximum)
            }
            let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
            camera.activeVideoMinFrameDuration = duration; camera.activeVideoMaxFrameDuration = duration
            if camera.isFocusModeSupported(.continuousAutoFocus) { camera.focusMode = .continuousAutoFocus }
            if camera.isExposureModeSupported(.continuousAutoExposure) { camera.exposureMode = .continuousAutoExposure }
            camera.unlockForConfiguration(); return fps
        } catch { return 30 }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let slot: DecoderSlot? = lock.withLock {
            guard !completed else { return nil }
            captured += 1; windowCaptured += 1
            guard let available = slots.first(where: { !$0.busy }) else { dropped += 1; return nil }
            available.busy = true; inFlight += 1
            return available
        }
        guard let slot else { return }
        let pixelBox = PixelBufferBox(pixel)
        slot.queue.async { [weak self, pixelBox, slot] in self?.decode(pixelBox.value, with: slot) }
    }

    private func decode(_ pixel: CVPixelBuffer, with slot: DecoderSlot) {
        var conversion = 0.0, location = 0.0, symbols = 0.0, usedCache: Int32 = 0
        CVPixelBufferLockBaseAddress(pixel, .readOnly)
        let width = CVPixelBufferGetWidthOfPlane(pixel, 0)
        let height = CVPixelBufferGetHeightOfPlane(pixel, 0)
        let result: Int32
        if let y = CVPixelBufferGetBaseAddressOfPlane(pixel, 0), let uv = CVPixelBufferGetBaseAddressOfPlane(pixel, 1) {
            result = slot.output.withUnsafeMutableBufferPointer { out in
                cimbarWorkerDecode(
                    slot.worker,
                    y.assumingMemoryBound(to: UInt8.self), UInt32(CVPixelBufferGetBytesPerRowOfPlane(pixel, 0)),
                    uv.assumingMemoryBound(to: UInt8.self), UInt32(CVPixelBufferGetBytesPerRowOfPlane(pixel, 1)),
                    UInt32(width), UInt32(height), out.baseAddress!, UInt32(out.count),
                    &conversion, &location, &symbols, &usedCache
                )
            }
        } else {
            result = -1
        }
        CVPixelBufferUnlockBaseAddress(pixel, .readOnly)

        let finalConversion = conversion
        let finalLocation = location
        let finalSymbols = symbols
        let finalUsedCache = usedCache != 0

        fountainQueue.async { [weak self, slot] in
            guard let self else { return }
            var fileID: Int64 = 0
            let shouldAccept = self.lock.withLock { !self.completed }
            if shouldAccept, result > 0 {
                fileID = slot.output.withUnsafeBufferPointer { cimbarFountain($0.baseAddress!, UInt32(result)) }
            }
            self.record(result: result, bytes: Int(max(result, 0)), conversion: finalConversion,
                        location: finalLocation, symbols: finalSymbols, usedCache: finalUsedCache, slot: slot)
            if fileID > 0 { self.finish(UInt32(fileID)) }
        }
    }

    private func record(result: Int32, bytes: Int, conversion: Double, location: Double,
                        symbols: Double, usedCache: Bool, slot: DecoderSlot) {
        let now = CACurrentMediaTime()
        lock.withLock {
            slot.busy = false; inFlight = max(inFlight - 1, 0)
            guard !completed else { return }
            processed += 1; windowProcessed += 1; stageSamples += 1
            convertTotal += conversion; locateTotal += location; symbolTotal += symbols
            if usedCache { cacheHits += 1 }
            if result > 0 {
                decoded += 1; windowDecoded += 1; decodedBytes += bytes; windowBytes += bytes
            } else if result == 0 { noData += 1 }
            else if result == -3 { rejected += 1 }
            else { errors += 1 }
        }
        publishIfNeeded(now: now)
    }

    private struct Snapshot: Sendable {
        let captured, processed, decoded, bytes, rejected, noData, errors, dropped, inFlight: Int
        let captureFPS, processFPS, decodeFPS, rate, convertMS, locateMS, symbolMS, cacheRate: Double
    }

    private func publishIfNeeded(now: CFTimeInterval) {
        let snapshot: Snapshot? = lock.withLock {
            let elapsed = now - windowStartedAt
            guard elapsed >= 0.5 else { return nil }
            let sampleCount = max(stageSamples, 1)
            let snap = Snapshot(
                captured: captured, processed: processed, decoded: decoded, bytes: decodedBytes,
                rejected: rejected, noData: noData, errors: errors, dropped: dropped, inFlight: inFlight,
                captureFPS: Double(windowCaptured) / elapsed,
                processFPS: Double(windowProcessed) / elapsed,
                decodeFPS: Double(windowDecoded) / elapsed,
                rate: Double(windowBytes) / elapsed,
                convertMS: convertTotal / Double(sampleCount), locateMS: locateTotal / Double(sampleCount),
                symbolMS: symbolTotal / Double(sampleCount), cacheRate: Double(cacheHits) / Double(sampleCount)
            )
            windowStartedAt = now; windowCaptured = 0; windowProcessed = 0; windowDecoded = 0; windowBytes = 0
            return snap
        }
        guard let snapshot else { return }
        let progress = readProgress()
        Task { @MainActor in
            model.captured = snapshot.captured; model.processed = snapshot.processed; model.decoded = snapshot.decoded
            model.decodedBytes = snapshot.bytes; model.rejected = snapshot.rejected; model.noData = snapshot.noData
            model.errors = snapshot.errors; model.dropped = snapshot.dropped; model.inFlight = snapshot.inFlight
            model.captureFPS = snapshot.captureFPS; model.processFPS = snapshot.processFPS; model.decodeFPS = snapshot.decodeFPS
            model.transferRate = snapshot.rate; model.progress = max(model.progress, progress)
            model.convertMS = snapshot.convertMS; model.locateMS = snapshot.locateMS
            model.symbolMS = snapshot.symbolMS; model.cacheHitRate = snapshot.cacheRate
            if snapshot.decoded > 0 { model.status = "正在接收文件…" }
            else if snapshot.rejected > 0 { model.status = "正在扫描画面 · 请保持四角完整清晰" }
        }
    }

    private func readProgress() -> Double {
        var bytes = [UInt8](repeating: 0, count: 1024)
        let count = bytes.withUnsafeMutableBufferPointer { cimbarReport($0.baseAddress!, UInt32($0.count)) }
        guard count > 0, let text = String(bytes: bytes.prefix(Int(count)), encoding: .utf8) else { return 0 }
        return text.split(whereSeparator: { ",[] ".contains($0) }).compactMap { Double($0) }.max() ?? 0
    }

    private func finish(_ id: UInt32) {
        let isFirst = lock.withLock { () -> Bool in
            guard !completed else { return false }
            completed = true; return true
        }
        guard isFirst else { return }
        if session.isRunning { session.stopRunning() }
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
        lock.withLock { completed = true }
        Task { @MainActor in model.hasError = true; model.isRunning = false; model.cameraReady = false; model.status = message }
    }
}

private extension NSLock {
    @discardableResult
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }; return try body()
    }
}
