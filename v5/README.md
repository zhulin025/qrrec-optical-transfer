# QRREC V5

V5 uses the libcimbar-compatible color-matrix runtime already vendored in V3. The sender remains a web app with the V3 visual language; the receiver is an iOS app.

## Sender

```bash
npm run dev:sender:v5
```

Build with `npm run build:sender:v5`. No deployment is performed.

## iOS receiver

Open `ios/OpticalReceiverV5/OpticalReceiverV5.xcodeproj` in Xcode, select a physical iPhone, configure a Development Team, then Run. A real device is required for camera transfer testing.

The app keeps the screen awake, grants the bundled local decoder camera access, runs libcimbar's four-worker WASM decoder, saves completed downloads in the app sandbox, and presents the system share sheet.

## Algorithm compatibility

- 4-bit visual symbols plus color bits
- Reed-Solomon error correction and cell interleaving
- Wirehair fountain frames for loss/out-of-order recovery
- Perspective extraction and chromatic adaptation from libcimbar

The current iOS integration deliberately embeds the known-good WASM decoder because the upstream native C++ build requires an iOS OpenCV toolchain that is not included in the downloaded libcimbar source tree.
