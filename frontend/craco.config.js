// craco.config.js
const path = require("path");
require("dotenv").config();

// Check if we're in development/preview mode (not production build)
// Craco sets NODE_ENV=development for start, NODE_ENV=production for build
const isDevServer = process.env.NODE_ENV !== "production";

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  // Add health check endpoints if enabled
  if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
    const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      // Call original setup if exists
      if (originalSetupMiddlewares) {
        middlewares = originalSetupMiddlewares(middlewares, devServer);
      }

      // Setup health endpoints
      setupHealthEndpoints(devServer, healthPluginInstance);

      return middlewares;
    };
  }

  return devServerConfig;
};

// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
      console.warn(
        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
      );
    } else {
      throw err;
    }
  }
}

// Compat shim: webpack-dev-server v5 removed onBeforeSetupMiddleware /
// onAfterSetupMiddleware (still emitted by react-scripts 5). Convert them to
// the supported setupMiddlewares API so the dev server passes schema validation.
function stripDeprecatedMiddleware(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;

  // wds4 `https` option was replaced by `server` in wds5.
  if ("https" in cfg) {
    const https = cfg.https;
    delete cfg.https;
    if (https) {
      cfg.server = https === true ? "https" : { type: "https", options: https };
    }
  }

  const before = cfg.onBeforeSetupMiddleware;
  const after = cfg.onAfterSetupMiddleware;
  if (before || after) {
    delete cfg.onBeforeSetupMiddleware;
    delete cfg.onAfterSetupMiddleware;
    const existing = cfg.setupMiddlewares;
    cfg.setupMiddlewares = (middlewares, devServer) => {
      if (before) before(devServer);
      let mw = middlewares;
      if (typeof existing === "function") mw = existing(mw, devServer);
      if (after) after(devServer);
      return mw;
    };
  }
  return cfg;
}

const prevDevServer = webpackConfig.devServer;
webpackConfig.devServer = (devServerConfig) => {
  let out =
    typeof prevDevServer === "function" ? prevDevServer(devServerConfig) : devServerConfig;
  return stripDeprecatedMiddleware(out);
};

module.exports = webpackConfig;
