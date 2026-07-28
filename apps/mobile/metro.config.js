// Monorepo wiring. npm workspaces hoist most packages to the repo root;
// anything that conflicts across apps (react 18 on web vs 19 here) stays
// nested in this app's own node_modules. Watching the repo root and resolving
// project-first means Metro always picks this app's copy and never sees two
// reacts. Recent expo/metro-config detects workspaces on its own, but being
// explicit costs nothing and survives that detection changing.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Resolve ONLY through the two paths above, instead of also walking up every
// parent directory's node_modules.
//
// Without this the app shipped two Reacts and died on first render with
// "Cannot read property 'useState' of null". The web app pins React 18 and
// this app pins 19, so npm hoists one copy to the repo root and nests the
// other here. React Native lives at the root, so its own `require("react")`
// found the root copy while app code got the nested one: two dispatchers,
// and hooks blow up the moment a component calls useState. Confirmed by
// exporting with source maps and finding react files from both paths in one
// bundle.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
