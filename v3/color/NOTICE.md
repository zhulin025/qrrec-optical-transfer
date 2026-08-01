# libcimbar web runtime notice

This directory vendors the browser encoder/decoder runtime from
[sz3/libcimbar](https://github.com/sz3/libcimbar), commit
`681e18eb61a059f4a796bc6ef097d24b45c430eb` (live build stamp
`2026-07-13T0523`). It is used as QRREC V3's experimental color icon matrix
channel.

libcimbar is Copyright its contributors and licensed under the Mozilla Public
License 2.0. The full license is included as `LICENSE.libcimbar`. Upstream
source corresponding to this runtime is available at:

https://github.com/sz3/libcimbar/tree/681e18eb61a059f4a796bc6ef097d24b45c430eb

Local integration changes are limited to relative PWA paths/cache isolation,
page titles, navigation links back to the QRREC V3 dual-QR pages, and fixing
the receiver's worker-ready messages being counted as completed video frames.
Both pages register one scope-safe integration service worker instead of
competing sender and receiver workers for the same browser scope. Empty/error
worker responses are ignored safely instead of dereferencing a missing buffer.
