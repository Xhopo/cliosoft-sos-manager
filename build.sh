#!/bin/bash
# ClioSoft SOS Manager - Build Script
# Version: 0.2.0

echo "========================================"
echo "ClioSoft SOS Manager v0.2.0"
echo "Build and Package Script"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check Node.js
echo "[1/5] Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed!${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✓ Node.js found: $(node --version)${NC}"
echo ""

# Step 2: Install dependencies
echo "[2/5] Installing dependencies..."
if ! npm install; then
    echo -e "${RED}ERROR: Failed to install dependencies!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 3: Compile TypeScript
echo "[3/5] Compiling TypeScript..."
if ! npm run compile; then
    echo -e "${RED}ERROR: TypeScript compilation failed!${NC}"
    echo "Please check the error messages above."
    exit 1
fi
echo -e "${GREEN}✓ TypeScript compiled successfully${NC}"
echo ""

# Step 4: Check vsce
echo "[4/5] Checking vsce installation..."
if ! npx @vscode/vsce --version &> /dev/null; then
    echo -e "${YELLOW}WARNING: vsce not found, installing...${NC}"
    if ! npm install -g @vscode/vsce; then
        echo -e "${RED}ERROR: Failed to install vsce!${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✓ vsce ready${NC}"
echo ""

# Step 5: Package VSIX
echo "[5/5] Packaging VSIX file..."
if ! npx @vscode/vsce package; then
    echo -e "${RED}ERROR: Failed to package VSIX!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ VSIX packaged successfully${NC}"
echo ""

# Success
echo "========================================"
echo -e "${GREEN}✅ BUILD COMPLETED SUCCESSFULLY!${NC}"
echo "========================================"
echo ""
echo "Output file: cliosoft-sos-manager-0.2.0.vsix"
echo ""
echo "Next steps:"
echo "1. Test the extension: code --install-extension cliosoft-sos-manager-0.2.0.vsix"
echo "2. Create GitHub Release"
echo "3. Upload VSIX file"
echo ""
