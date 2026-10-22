const fs = require('fs');
const path = require('path');
const { ConsoleRemotePlugin } = require('@openshift-console/dynamic-plugin-sdk-webpack');

// npm workspaces hoist PatternFly to the repo root, where the SDK does not look by default.
const rootNodeModules = path.resolve(__dirname, '../../node_modules');

// The console supplies PatternFly CSS. The SDK drops it only from this package's node_modules,
// so drop the hoisted copy too, or the plugin ships a second stylesheet over the console's.
const pfStylesDir = path.join(rootNodeModules, '@patternfly/react-styles');
const hoistedPatternFlyStyles = Object.fromEntries(
  fs
    .readdirSync(pfStylesDir, { recursive: true })
    .filter(file => file.endsWith('.css'))
    .map(file => [path.join(pfStylesDir, file), false]),
);

// The SDK adds this loader by bare name in a beforeLoaders hook, which skips resolveLoader, so
// the hoisted webpack require()s it from the root and fails. Point it at this package's copy.
const SDK_LOADER = '@openshift-console/dynamic-plugin-sdk-webpack/lib/webpack/loaders/dynamic-module-import-loader';
const resolveSdkLoader = {
  apply(compiler) {
    compiler.hooks.compilation.tap('ResolveSdkLoader', compilation => {
      compiler.webpack.NormalModule.getCompilationHooks(compilation).beforeLoaders.tap('ResolveSdkLoader', loaders => {
        loaders.forEach(entry => {
          if (entry.loader === SDK_LOADER) entry.loader = require.resolve(SDK_LOADER);
        });
      });
    });
  },
};

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  context: __dirname,
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]-bundle-[contenthash].min.js',
    chunkFilename: '[name]-chunk-[contenthash].min.js',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: hoistedPatternFlyStyles,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: { configFile: path.resolve(__dirname, 'tsconfig.json'), transpileOnly: true },
      },
    ],
  },
  plugins: [
    new ConsoleRemotePlugin({
      sharedDynamicModuleSettings: {
        modulePaths: [path.resolve(__dirname, 'node_modules'), rootNodeModules],
      },
    }),
    resolveSdkLoader,
  ],
  devtool: 'source-map',
  optimization: { chunkIds: 'named', minimize: process.env.NODE_ENV === 'production' },
};
