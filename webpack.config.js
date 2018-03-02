const path = require('path');
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const rxPaths = require('rxjs/_esm5/path-mapping');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const ProgressBarPlugin = require('progress-bar-webpack-plugin');

module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'build'),
    filename: 'potree.js',
    library: 'potree',
    libraryTarget: 'umd',
    umdNamedDefine: true,
  },
  devtool: 'cheap-eval-source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    alias: rxPaths(),
  },
  externals: ['three'],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
        },
      },
      { test: /\.tsx?$/, loader: 'ts-loader' },
      {
        test: path.resolve(__dirname, 'node_modules/rxjs'),
        sideEffects: false,
      },
    ],
  },
  plugins: [
    new CircularDependencyPlugin({
      exclude: /node_modules/,
      failOnError: true,
      cwd: process.cwd(),
    }),
    new ProgressBarPlugin(),
  ],
};
