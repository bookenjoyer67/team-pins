#!/usr/bin/env bash
set -euo pipefail

# PiggPin multi-platform build script
# Builds binaries for: linux | macos | windows | android

PLATFORM="${1:-linux}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Building PiggPin for platform: $PLATFORM ==="

# Step 1: Build WASM crypto core
echo "--- Building WASM crypto core ---"
cd "$ROOT/core"
  if ! command -v wasm-pack &>/dev/null && ! command -v cargo &>/dev/null; then
    echo "wasm-pack not found. Install with: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | bash"
    exit 1
  fi
  if ! command -v wasm-pack &>/dev/null; then
    cargo install wasm-pack --version 0.13.1 --locked
  fi
wasm-pack build --target web
cd "$ROOT"

# Step 2: Build web frontend
echo "--- Building web frontend ---"
npm run build

# Step 3: Platform-specific builds
case "$PLATFORM" in
  linux)
    echo "--- Building Linux binary ---"
    npx tauri build --target x86_64-unknown-linux-gnu
    echo ""
    echo "Linux artifacts:"
    echo "  Binary: src-tauri/target/release/piggpin"
    echo "  DEB:    src-tauri/target/release/bundle/deb/PiggPin_*.deb"
    echo "  RPM:    src-tauri/target/release/bundle/rpm/PiggPin-*.rpm"
    echo "  AppImage: src-tauri/target/release/bundle/appimage/PiggPin_*.AppImage"
    ;;
  macos)
    echo "--- Building macOS binary ---"
    npx tauri build --target aarch64-apple-darwin
    echo ""
    echo "macOS artifacts:"
    echo "  DMG: src-tauri/target/release/bundle/dmg/PiggPin_*.dmg"
    ;;
  windows)
    echo "--- Building Windows binary ---"
    npx tauri build --target x86_64-pc-windows-msvc
    echo ""
    echo "Windows artifacts:"
    echo "  MSI: src-tauri/target/release/bundle/msi/PiggPin_*.msi"
    echo "  EXE: src-tauri/target/release/bundle/nsis/PiggPin_*.exe"
    ;;
  android)
    echo "--- Building Android APK ---"
    npx cap sync android
    cd "$ROOT/android"
    ./gradlew assembleRelease
    echo ""
    echo "Android artifacts:"
    echo "  APK: android/app/build/outputs/apk/release/app-release.apk"
    echo "  APK: android/app/build/outputs/apk/debug/app-debug.apk"
    ;;
  all)
    echo "Use CI/CD (GitHub Actions) for cross-platform builds."
    echo "Run locally per platform: $0 [linux|macos|windows|android]"
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    echo "Usage: $0 [linux|macos|windows|android]"
    exit 1
    ;;
esac

echo "=== Build complete ==="
