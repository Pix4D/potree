const path = require('path');

module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, ' build'),
    filename: 'potree.js',
    library: 'Potree',
  },
  devtool: 'inline-source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
  },
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
        test: /\.(glsl|fs|vs)$/,
        loader: 'webpack-glsl',
      },
    ],
  },
};
