#!/bin/zsh
# Copy the libraries the site uses from node_modules into vendor/ (run after
# npm install / upgrading three or rapier). The site loads only vendor/, so it
# can be served as static files (GitHub Pages) without node_modules.
cd "$(dirname "$0")/.."
mkdir -p vendor/three/addons/controls vendor/rapier vendor/mp4-muxer
cp node_modules/three/build/three.module.js node_modules/three/build/three.core.js node_modules/three/LICENSE vendor/three/
cp node_modules/three/examples/jsm/controls/OrbitControls.js vendor/three/addons/controls/
cp node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs node_modules/@dimforge/rapier3d-compat/LICENSE vendor/rapier/
cp node_modules/mp4-muxer/build/mp4-muxer.mjs node_modules/mp4-muxer/LICENSE vendor/mp4-muxer/
echo "vendored three $(node -p "require('./node_modules/three/package.json').version"), rapier $(node -p "require('./node_modules/@dimforge/rapier3d-compat/package.json').version"), mp4-muxer $(node -p "require('./node_modules/mp4-muxer/package.json').version")"
