#!/bin/bash
set -e

echo "============================================"
echo "  AI Retouch - macOS Full Build"
echo "============================================"
echo

# ── Step 1 ──
echo "[1/8] Building shared package..."
pnpm build:shared
echo

# ── Step 2 ──
echo "[2/8] Building server (pack)..."
pnpm build:server:pack
echo

# ── Step 3 ──
echo "[3/8] Preparing server (bytecode + sharp)..."
pnpm prepare-server
echo

# ── Step 4 ──
echo "[4/8] Building UXP plugin..."
pnpm build:plugin
echo

# ── Step 5 ──
echo "[5/8] Building CCX package..."
pnpm build:ccx
echo

# ── Step 6 ──
echo "[6/8] Building Electron app..."
pnpm build:electron
echo

# ── Step 7 ──
echo "[7/8] Converting icon.png to icon.icns..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
ICON_PNG="$ROOT_DIR/icon.png"
ICON_ICNS="$ROOT_DIR/apps/electron/resources/icon.icns"

if [ -f "$ICON_PNG" ]; then
  ICONDIR=$(mktemp -d)
  mkdir -p "$ICONDIR/icon.iconset"
  for SIZE in 16 32 64 128 256 512; do
    sips -z $SIZE $SIZE "$ICON_PNG" --out "$ICONDIR/icon.iconset/icon_${SIZE}x${SIZE}.png" > /dev/null
    DOUBLE=$((SIZE * 2))
    if [ $DOUBLE -le 1024 ]; then
      sips -z $DOUBLE $DOUBLE "$ICON_PNG" --out "$ICONDIR/icon.iconset/icon_${SIZE}x${SIZE}@2x.png" > /dev/null
    fi
  done
  sips -z 1024 1024 "$ICON_PNG" --out "$ICONDIR/icon.iconset/icon_512x512@2x.png" > /dev/null
  iconutil -c icns "$ICONDIR/icon.iconset" -o "$ICON_ICNS"
  rm -rf "$ICONDIR"
  echo "  Icon converted: icon.icns"
else
  echo "  WARNING: icon.png not found, skipping icon conversion"
fi
echo

# ── Step 8 ──
echo "[8/8] Packaging with electron-builder..."
cd apps/electron

# Use CSC_IDENTITY_AUTO_DISCOVERY=false to skip signing if no cert is available
if [ -z "$CSC_LINK" ]; then
  echo "  (Building without code signing)"
  CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac
else
  echo "  (Building with code signing)"
  npx electron-builder --mac
fi
cd ../..
echo

echo "============================================"
echo "  BUILD SUCCESSFUL"
echo "============================================"
echo
echo "  Output:"
echo "    PKG installer : apps/electron/release/AI-Retouch-*.pkg"
echo "    Unpacked       : apps/electron/release/mac*/"
echo
