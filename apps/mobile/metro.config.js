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

module.exports = config;
