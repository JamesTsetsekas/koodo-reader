// Production React, readable bundles for local maintenance. Type-check first;
// avoid running a second 2 GB TypeScript worker alongside the bundler.
process.env.NODE_ENV = "production";
process.env.BABEL_ENV = "production";
process.env.GENERATE_SOURCEMAP = "false";
process.env.DISABLE_ESLINT_PLUGIN = "true";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], { stdio: "inherit" });
const webpack = require("webpack");
const config = require("react-scripts/config/webpack.config")("production");
config.optimization.minimize = false;
config.plugins = config.plugins.filter((plugin) => plugin.constructor.name !== "ForkTsCheckerWebpackPlugin");
fs.mkdirSync(path.join(process.cwd(), "build"), { recursive: true });
fs.cpSync("public", "build", { recursive: true, filter: (source) => source !== path.join("public", "index.html") });
webpack(config, (error, stats) => {
  if (error) { console.error(error); process.exitCode = 1; return; }
  console.log(stats.toString({ all: false, errors: true, warnings: true, timings: true }));
  if (stats.hasErrors()) process.exitCode = 1;
});
