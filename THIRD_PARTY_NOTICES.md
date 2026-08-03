# Third-party notices

## libcimbar web runtime

QRREC V3 includes a separated copy of the libcimbar browser runtime under
`v3/color/`. libcimbar is developed by sz3 and contributors and is licensed
under the Mozilla Public License 2.0, not QRREC's MIT license.

- Project: https://github.com/sz3/libcimbar
- Pinned source: https://github.com/sz3/libcimbar/tree/681e18eb61a059f4a796bc6ef097d24b45c430eb
- Local license: `v3/color/LICENSE.libcimbar`
- Local notice and modification summary: `v3/color/NOTICE.md`

The remaining QRREC source is available under the repository's MIT license.

## RaptorQR V6 runtime

QRREC V6 uses the published RaptorQR codec and QR-rendering packages, pinned at
version `0.1.1`. These packages are licensed under the MIT License.

- `@raptorqr/core`: protocol, RaptorQ packetization, scheduling and QR facade
- `@raptorqr/raptorq-wasm`: Rust RaptorQ codec compiled to WebAssembly
- `@raptorqr/fast-qr-wasm`: Rust fast_qr renderer compiled to WebAssembly
- Project: https://github.com/infrost/raptorqr

The V6 scanner uses ZXing-C++ through `zxing-wasm`; ZXing-C++ and zxing-wasm
are distributed under the Apache License 2.0. RaptorQR's RaptorQ wrapper is
based on `cberner/raptorq`, which is dual-licensed under MIT or Apache-2.0.
The package license texts remain included in the installed npm artifacts and
their notices must be preserved when redistributing a standalone V6 bundle.
