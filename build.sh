#!/usr/bin/env bash
# exit on error
set -o errexit

# Install standard npm packages
npm install

# Force-download Chrome binary for Puppeteer into Render's cache layer
echo "Installing dedicated Chromium engine instance..."
npx puppeteer browsers install chrome