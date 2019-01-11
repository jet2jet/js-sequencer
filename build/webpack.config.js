
const fs = require('fs');
const path = require('path');

const webpack = require('webpack');

const packageJson = require('../package.json');

const LIBRARY_NAME = 'js-sequencer';
const LIBRARY_FILENAME = 'js-sequencer';
const LIBRARY_NAMESPACE = 'JSSeq';
const LIBRARY_VERSION = packageJson.version;
const AUTHOR = packageJson.author;

const isMinified = process.env.NODE_ENV === 'minified';
const suffix = isMinified ? '.min' : '';

const headerTextTemplate = fs.readFileSync(path.resolve(__dirname, '../src/banner/header.txt'), 'utf8');
const preparedHeaderText = prependHeaderTextImpl(
	LIBRARY_NAME, AUTHOR, LIBRARY_VERSION
);

const webpackConfBase = {
	mode: isMinified ? 'production' : 'development',
	devtool: 'source-map',
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: [
					{
						loader: 'ts-project-loader',
						options: {
							tempBuildDir: isMinified ? void (0) : path.resolve(__dirname, '../dist/lib'),
							compilerOptions: {
								declaration: !isMinified
							}
						}
					}
				]
			}
		]
	},
	optimization: {
		concatenateModules: true,
		namedModules: false
	},
	plugins: [
		new webpack.BannerPlugin({
			banner: preparedHeaderText,
			raw: true
		})
	]
};

module.exports = [
	Object.assign({
		entry: {
			[LIBRARY_FILENAME]: path.resolve(__dirname, '../src/main/index.ts')
		},
		externals: {
			'js-synthesizer': {
				commonjs: 'js-synthesizer',
				commonjs2: 'js-synthesizer',
				amd: 'js-synthesizer',
				root: 'JSSynth'
			}
		},
		output: {
			path: path.resolve(__dirname, '../dist'),
			filename: `[name]${suffix}.js`,
			libraryTarget: 'umd',
			library: {
				root: LIBRARY_NAMESPACE,
				amd: LIBRARY_NAMESPACE,
				commonjs: LIBRARY_NAME
			},
			globalObject: 'this'
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js'],
			modules: [
				path.resolve(__dirname, '..', 'src', 'main'),
				path.resolve(__dirname, '..', 'src', 'common'),
				path.resolve(__dirname, '..', 'reference'),
				'node_modules'
			]
		},
	}, webpackConfBase),
	Object.assign({
		entry: {
			[`${LIBRARY_FILENAME}.worker`]: path.resolve(__dirname, '../src/worker/index.ts')
		},
		externals: {
			'js-synthesizer': 'JSSynth'
		},
		output: {
			path: path.resolve(__dirname, '../dist'),
			filename: `[name]${suffix}.js`
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js'],
			modules: [
				path.resolve(__dirname, '..', 'src', 'worker'),
				path.resolve(__dirname, '..', 'src', 'common'),
				path.resolve(__dirname, '..', 'reference'),
				'node_modules'
			]
		},
	}, webpackConfBase),
	Object.assign({
		entry: {
			[`${LIBRARY_FILENAME}.worklet`]: path.resolve(__dirname, '../src/worklet/index.ts')
		},
		externals: {
			'js-synthesizer': 'JSSynth'
		},
		output: {
			path: path.resolve(__dirname, '../dist'),
			filename: `[name]${suffix}.js`
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js'],
			modules: [
				path.resolve(__dirname, '..', 'src', 'worklet'),
				path.resolve(__dirname, '..', 'src', 'common'),
				path.resolve(__dirname, '..', 'reference'),
				'node_modules'
			]
		},
	}, webpackConfBase)
];

/**
 * @param {number|string} num numeric data
 * @param {number} length minimum length
 * @return {string} converted string
 */
function toNumberStringWithZero(num, length) {
	num = num.toString();
	length -= num.length;
	if (length > 0)
		num = Array(length + 1).join('0') + num;
	return num;
}

function prependHeaderTextImpl(name, author, version) {
	var date = new Date();
	return headerTextTemplate
		.replace('[name]', name)
		.replace('[author]', author)
		.replace('[version]', version || '')
		.replace('[year4]', toNumberStringWithZero(date.getFullYear(), 4))
		.replace(
			'[date]',
			toNumberStringWithZero(date.getFullYear(), 4) + '-' +
			toNumberStringWithZero(date.getMonth() + 1, 2) + '-' +
			toNumberStringWithZero(date.getDate(), 2)
		);
}
