#!/bin/sh
set -e

# Differing installer script
# Usage: curl -sSL https://raw.githubusercontent.com/philz/differing/main/install.sh | sh

VERSION="${VERSION:-0.1.0}"
REPO="philz/differing"

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Linux*)     OS="linux";;
    Darwin*)    OS="darwin";;
    *)          echo "Unsupported OS: $OS"; exit 1;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)     ARCH="amd64";;
    aarch64)    ARCH="arm64";;
    arm64)      ARCH="arm64";;
    *)          echo "Unsupported architecture: $ARCH"; exit 1;;
esac

# Construct download URL
FILENAME="differing_${VERSION}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/v${VERSION}/${FILENAME}"

echo "Downloading differing ${VERSION} for ${OS}/${ARCH}..."
echo "URL: ${URL}"

# Download and extract
curl -sSL "$URL" | tar xzf - differing

# Make executable
chmod +x differing

echo ""
echo "✓ differing installed successfully!"
echo ""
echo "To use differing, run:"
echo "  ./differing"
echo ""
echo "Or move it to your PATH:"
echo "  sudo mv differing /usr/local/bin/"
