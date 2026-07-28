// The mobile app installs on its own, outside the npm workspace, so all of
// its dependencies live in apps/mobile/node_modules.
//
// Normal (hierarchical) resolution is left ON, because npm nests some
// transitive packages inside their parent, e.g.
// expo-router/node_modules/@expo/metro-runtime, and switching it off makes
// those unresolvable.
//
// React alone is pinned to this app's copy. It is the one package where a
// second copy is fatal rather than merely wasteful: two Reacts means two
// hook dispatchers, and the app dies on first render with "Cannot read
// property 'useState' of null". The repo root still has the web app's React
// 18 sitting one directory up, so this closes the door on that permanently
// instead of relying on npm never hoisting differently.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const localModules = path.resolve(projectRoot, "node_modules");
config.resolver.nodeModulesPaths = [localModules];

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return resolve(context, path.join(localModules, moduleName), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
