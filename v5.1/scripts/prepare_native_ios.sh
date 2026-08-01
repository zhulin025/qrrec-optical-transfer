#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
V51_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$V51_ROOT/.." && pwd)"
APP_ROOT="$V51_ROOT/ios/OpticalReceiverV51"
DEPS_ROOT="$APP_ROOT/Dependencies"
OPENCV_VERSION="4.11.0"
OPENCV_ZIP="${TMPDIR:-/tmp}/qrrec-opencv-${OPENCV_VERSION}.zip"
OPENCV_URL="https://github.com/opencv/opencv/releases/download/${OPENCV_VERSION}/opencv-${OPENCV_VERSION}-ios-framework.zip"

mkdir -p "$DEPS_ROOT"
if [[ ! -d "$DEPS_ROOT/opencv2.framework" ]]; then
  echo "Downloading OpenCV ${OPENCV_VERSION} iOS framework..."
  curl -fL "$OPENCV_URL" -o "$OPENCV_ZIP"
  ditto -x -k "$OPENCV_ZIP" "$DEPS_ROOT"
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "cmake is required. Install it with: brew install cmake" >&2
  exit 1
fi

cmake -S "$V51_ROOT/native/libcimbar" -B "$V51_ROOT/native/build" -G Xcode \
  -DQRREC_IOS=ON \
  -DQRREC_OPENCV_FRAMEWORK="$DEPS_ROOT/opencv2.framework" \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_SYSROOT=iphoneos \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=16.0 \
  -DCMAKE_BUILD_TYPE=Release

cmake --build "$V51_ROOT/native/build" --config Release --target cimbar_js -j "$(sysctl -n hw.logicalcpu)"
LIBRARIES=()
while IFS= read -r -d '' library; do LIBRARIES+=("$library"); done < <(find "$V51_ROOT/native/build/build" -name '*.a' -type f -print0)
/usr/bin/libtool -static -o "$DEPS_ROOT/libqrrec_cimbar.a" "${LIBRARIES[@]}"
echo "Native dependencies are ready: $APP_ROOT"
