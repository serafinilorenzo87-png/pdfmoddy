// Static-rendered SPA: no SSR (Tauri serves the build/ folder statically),
// prerender enabled so adapter-static can emit the shell at build time.
export const prerender = true;
export const ssr = false;
