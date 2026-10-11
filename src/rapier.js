// Single import point for the physics engine (inlined-wasm build, so it
// loads the same way in the page, in workers and under Node). Vendored, with
// three.js, so the site can be served as plain static files; tools/vendor.sh
// copies them from node_modules after an upgrade.
export { default } from '../vendor/rapier/rapier.mjs';
