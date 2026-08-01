import Foundation
import Network

/// Serves the bundled decoder on a trustworthy localhost origin. WKWebView
/// restricts workers, WebAssembly fetches, and camera capture on file:// URLs.
final class LocalWebServer: @unchecked Sendable {
    enum ServerError: LocalizedError {
        case missingResources
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .missingResources: return "找不到内置解码资源"
            case .failed(let reason): return "本地解码服务启动失败：\(reason)"
            }
        }
    }

    private let queue = DispatchQueue(label: "com.qrrec.v5.local-web-server", qos: .userInitiated)
    private var listener: NWListener?
    private let root: URL

    init?() {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
              FileManager.default.fileExists(atPath: root.path) else { return nil }
        self.root = root
    }

    func start(completion: @escaping @Sendable (Result<URL, Error>) -> Void) {
        do {
            let parameters = NWParameters.tcp
            parameters.requiredInterfaceType = .loopback
            let listener = try NWListener(using: parameters, on: .any)
            self.listener = listener
            listener.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
            listener.stateUpdateHandler = { [weak listener] state in
                switch state {
                case .ready:
                    guard let port = listener?.port else {
                        completion(.failure(ServerError.failed("未获得端口")))
                        return
                    }
                    completion(.success(URL(string: "http://127.0.0.1:\(port.rawValue)/runtime-recv.html")!))
                case .failed(let error): completion(.failure(ServerError.failed(error.localizedDescription)))
                default: break
                }
            }
            listener.start(queue: queue)
        } catch {
            completion(.failure(error))
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, error in
            guard let self, let data, error == nil,
                  let request = String(data: data, encoding: .utf8),
                  let requestLine = request.split(separator: "\r\n").first else {
                connection.cancel(); return
            }
            let fields = requestLine.split(separator: " ")
            guard fields.count >= 2 else { self.respond(status: "400 Bad Request", data: Data(), mime: "text/plain", on: connection); return }
            let rawPath = String(fields[1]).split(separator: "?", maxSplits: 1).first.map(String.init) ?? "/"
            let decoded = rawPath.removingPercentEncoding ?? rawPath
            let relative = decoded == "/" ? "runtime-recv.html" : String(decoded.drop(while: { $0 == "/" }))
            guard !relative.contains("..") else { self.respond(status: "403 Forbidden", data: Data(), mime: "text/plain", on: connection); return }
            let file = self.root.appendingPathComponent(relative)
            guard let body = try? Data(contentsOf: file) else { self.respond(status: "404 Not Found", data: Data(), mime: "text/plain", on: connection); return }
            self.respond(status: "200 OK", data: body, mime: self.mimeType(for: file.pathExtension), on: connection)
        }
    }

    private func respond(status: String, data: Data, mime: String, on connection: NWConnection) {
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(mime)\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nCross-Origin-Opener-Policy: same-origin\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8)
        response.append(data)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "wasm": return "application/wasm"
        case "json": return "application/json"
        case "png": return "image/png"
        default: return "application/octet-stream"
        }
    }
}
