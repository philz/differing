#!/bin/sh
set -e

# Differing installer script
# Usage: curl -sSL https://raw.githubusercontent.com/philz/differing/main/install.sh | sh

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

# Get latest release version
echo "Fetching latest release..."
VERSION=$(curl -sSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    echo "Error: Could not determine latest version"
    exit 1
fi

# Construct download URL - binary format (no .tar.gz)
FILENAME="differing_${OS}_${ARCH}"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${FILENAME}"

echo "Downloading differing ${VERSION} for ${OS}/${ARCH}..."

# Download binary directly
curl -sSL -o differing "$URL"

# Make executable
chmod +x differing

echo ""
echo "✓ differing ${VERSION} installed successfully!"
echo ""
echo "To use differing, run:"
echo "  ./differing"
echo ""
echo "Or move it to your PATH:"
echo "  sudo mv differing /usr/local/bin/"
