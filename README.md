# QRREC Optical Transfer

QRREC lets two devices transfer files through a screen and a camera. The sender turns a file into an endless animated QR stream; the receiver scans any useful frames, reconstructs the file, verifies it, and previews images, video, or text locally. File bytes never pass through a server.

## Online demo

| Version | Receiver | Sender | Purpose |
| --- | --- | --- | --- |
| V1 | [qrrec.liuwa.xyz](https://qrrec.liuwa.xyz/) | [qrrec.liuwa.xyz/send/](https://qrrec.liuwa.xyz/send/) | Stable baseline |
| V2 | [qrrec.liuwa.xyz/v2/](https://qrrec.liuwa.xyz/v2/) | [qrrec.liuwa.xyz/v2/send/](https://qrrec.liuwa.xyz/v2/send/) | High-speed experimental path |
| V3 | [qrrec.liuwa.xyz/v3/](https://qrrec.liuwa.xyz/v3/) | [qrrec.liuwa.xyz/v3/send/](https://qrrec.liuwa.xyz/v3/send/) | 30 FPS dual QR plus color-matrix channel |

Open the sender on a laptop or another bright screen, select a file, then open the matching receiver on a phone and point its camera at the animated codes. V1 and V2 use different file envelopes; use the matching sender and receiver.

## V2 features

- **Adaptive high-speed parameters** — the sender selects a dense payload and frame rate from the display capability; the receiver raises decode resolution when it cannot find codes and backs off after sustained success.
- **Stable-frame detection** — once both codes are located, frames with excessive mid-tone/blur-like pixels are discarded before expensive WASM decoding.
- **Dual ROI decoding** — the receiver first searches the full frame, then assigns the two located QR regions to separate workers. This reduces pixels processed per decode and allows two data frames per display tick.
- **Transparent compression** — gzip is used only when it actually reduces the payload. The receiver restores and validates the original bytes automatically.
- **Dual QR mode** — two independent fountain frames are displayed side by side. Single-code mode remains available for difficult camera or display conditions.
- **Local result preview** — images, playable video, text, and URLs are shown in the browser; downloading remains an explicit user action.
- **PWA receiver** — the receiver can be installed and its shell is cached for repeat use. Camera access still requires HTTPS.

## V3 modes

V3 leaves V1 and V2 unchanged and exposes two independent optical channels:

- **Optimized dual QR** at `/v3/` and `/v3/send/`: 30 display ticks per second, overlapping left/right ROI acquisition, two parallel decode workers, stable-frame filtering, and a 128-sample visual fingerprint that avoids spending decode time on the same displayed frame twice.
- **Color matrix (experimental)** is available as an in-page tab on `/v3/` and `/v3/send/`. It reuses the encoding/decoding runtime from `sz3/libcimbar` (shape and color symbols, Reed–Solomon correction, interleaving, Wirehair fountain coding, and zstd compression) while keeping QRREC's own interface. This channel is protocol-incompatible with QRREC's QR modes; use the color-matrix tab on both ends.

The color-matrix runtime is MPL-2.0 software and remains clearly separated from QRREC's MIT-licensed source. Its license, pinned upstream commit, and integration changes are documented in `v3/color/NOTICE.md` and `v3/color/LICENSE.libcimbar`.

### V4 record-first transfer

V4 separates capture from decoding. The sender repeats a finite, locally verified set of fountain frames and reports both its complete cycle duration and a recommended recording duration. The receiver records camera video without doing live barcode work, releases the camera as soon as recording stops, then samples the local video at 30 frames per second and decodes QR frames in a WASM worker. Processing stops early once the fountain decoder reconstructs and verifies the file. Existing camera recordings can also be imported from the device.

## Why fountain codes

An optical one-way link has no practical retransmission channel. Frames can be lost to autofocus, motion, screen refresh boundaries, or decoder load. QRREC splits the payload into source blocks and continuously sends deterministic XOR combinations chosen with a Robust Soliton distribution (LT fountain coding). The receiver can recover from any sufficiently large set of distinct encoded frames, regardless of order. A missed frame therefore costs time, not correctness, and there is no fragile fixed cycle that can synchronize with the receiver's sampling period.

Each frame carries a compact 20-byte binary header containing the session id, sequence number, source block count, block size, payload length, and hash. The sequence number seeds the same deterministic block selection on both devices; it is not merely an index into a repeating list.

## Architecture

```text
file → optional gzip → V2 envelope → source blocks → Robust Soliton LT encoder
     → one/two animated QR codes → camera → stable-frame filter → full-frame search
     → dual ROI workers → ZXing WASM → LT peeling decoder → hash check
     → optional gunzip → browser preview / optional download
```

Safari does not provide a dependable cross-browser native QR detector, so the receiver uses [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) through [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) in Web Workers. Web builds load WASM as a separate cacheable asset for fast Worker startup; the Xiaohongshu-specific build can embed it into JavaScript for hosts that reject standalone `.wasm` files.

## Local development

Requirements: Node.js 20 or newer and a modern browser.

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build:web
```

The static site is generated in `release/web-receiver` with these routes:

- `/` and `/send/`: V1 receiver and sender
- `/v2/` and `/v2/send/`: V2 receiver and sender
- `/v3/` and `/v3/send/`: V3 receiver and sender, each with High-speed QR and Color matrix tabs
- `/v4/` and `/v4/send/`: record-first receiver and fixed-cycle dual-QR sender; decoding runs locally after recording stops

Camera access requires HTTPS except on `localhost`. For phone testing, use an HTTPS development origin or deploy the static build.

## Tuning and expectations

The effective rate depends on screen refresh rate and brightness, camera exposure/focus, QR density, distance, worker performance, and how much the file compresses. V2 defaults to a stable dual-code profile: 20 display ticks per second and 1000 bytes per code, automatically rising to 1465 bytes only when each code has ample display area. If recognition is unstable, try one code, fewer bytes per frame, a lower frame rate, or a larger display size.

Dual QR mode doubles the offered payload but does not guarantee double goodput: both codes must remain large and sharp enough for the camera. The live metrics show captured frames, successful decodes, new versus duplicate fountain frames, stable versus filtered frames, ROI state, and estimated useful throughput.

## Project lineage

This repository builds on the original MIT-licensed **Decimen Optical Transfer** proof of concept and keeps its compact binary protocol, deterministic fountain implementation, and optical-only design. The UI/PWA and preview workflow were informed by Qrs. Related projects worth studying include [txqr](https://github.com/divan/txqr), [airgapped-qr-code-transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer), and [libcimbar](https://github.com/sz3/libcimbar), which uses a purpose-built high-density color barcode rather than standard QR.

Built with [node-qrcode](https://github.com/soldair/node-qrcode), [zxing-wasm](https://github.com/Sec-ant/zxing-wasm), and [fflate](https://github.com/101arrowz/fflate).

## Privacy and limitations

- No file content is uploaded by QRREC; all encoding and decoding happens in the browser.
- The deployed web shell still needs normal network access to load on first visit.
- Anyone who can see and record the animated codes can reconstruct the file. Optical transfer is not encryption.
- V2 is an experimental performance path. Keep V1 available as the compatibility baseline.

## License

QRREC's own source is MIT; see [LICENSE](LICENSE). The separated libcimbar web runtime under `v3/color/` is MPL-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
