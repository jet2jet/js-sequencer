const fs = require('fs');
const path = require('path');

const webpack = require('webpack');

const packageJson = require('../package.json');

const LIBRARY_NAME = 'js-sequencer';
const LIBRARY_FILENAME = 'js-sequencer';
const LIBRARY_NAMESPACE = 'JSSeq';
const LIBRARY_VERSION = packageJson.version;
const AUTHOR = packageJson.author;

const sourceRootDir = path.resolve(__dirname, '../src');
const mainRootPath = path.resolve(__dirname, '../src/main');
const commonRootPath = path.resolve(__dirname, '../src/common');

const moduleExtensions = ['.tsx', '.ts', '.js'];

const headerTextTemplate = fs.readFileSync(
	path.resolve(__dirname, '../src/banner/header.txt'),
	'utf8'
);
const preparedHeaderText = prependHeaderTextImpl(
	LIBRARY_NAME,
	AUTHOR,
	LIBRARY_VERSION
);

/**
 * @param {number|string} num numeric data
 * @param {number} length minimum length
 * @return {string} converted string
 */
function toNumberStringWithZero(num, length) {
	num = num.toString();
	length -= num.length;
	if (length > 0) num = Array(length + 1).join('0') + num;
	return num;
}

function prependHeaderTextImpl(name, author, version) {
	const date = new Date();
	return headerTextTemplate
		.replace('[name]', name)
		.replace('[author]', author)
		.replace('[version]', version || '')
		.replace('[year4]', toNumberStringWithZero(date.getFullYear(), 4))
		.replace(
			'[date]',
			toNumberStringWithZero(date.getFullYear(), 4) +
				'-' +
				toNumberStringWithZero(date.getMonth() + 1, 2) +
				'-' +
				toNumberStringWithZero(date.getDate(), 2)
		);
}

function existsModule(name, extensions) {
	return (
		fs.existsSync(name) ||
		extensions.some((ext) => {
			return fs.existsSync(name + ext);
		})
	);
}

module.exports = (env) => {
	const isMinified = !!(env && env.minified);
	const suffix = isMinified ? '.min' : '';

	const webpackConfBase = {
		mode: isMinified ? 'production' : 'development',
		devtool: 'source-map',
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					use: [
						{
							loader: 'ts-loader',
							options: {
								compilerOptions: {
									declaration: false,
								},
							},
						},
					],
				},
			],
		},
		optimization: {
			concatenateModules: true,
			namedModules: false,
		},
		plugins: [
			new webpack.BannerPlugin({
				banner: preparedHeaderText,
				raw: true,
			}),
			new webpack.NormalModuleReplacementPlugin(/^\./, (resource) => {
				// if module is not found in the project directory, search commonRootPath
				const inputPath = path.resolve(
					resource.context,
					resource.request
				);
				if (!existsModule(inputPath, moduleExtensions)) {
					const relPathFromSrc = path.normalize(
						path.relative(sourceRootDir, inputPath)
					);
					if (!/^\.\./.test(relPathFromSrc)) {
						const relPathFromProject = relPathFromSrc.replace(
							/^.*?[\\/]/,
							''
						);
						const commonPath = path.resolve(
							commonRootPath,
							relPathFromProject
						);
						if (existsModule(commonPath, moduleExtensions)) {
							resource.request = path.relative(
								resource.context,
								commonPath
							);
						}
					}
				}
				// console.log('[NormalModuleReplacementPlugin]', resource);
			}),
		],
	};

	return [
		Object.assign(
			{
				entry: {
					[LIBRARY_FILENAME]: path.resolve(mainRootPath, 'index.ts'),
				},
				externals: {
					'js-synthesizer': {
						commonjs: 'js-synthesizer',
						commonjs2: 'js-synthesizer',
						amd: 'js-synthesizer',
						root: 'JSSynth',
					},
				},
				output: {
					path: path.resolve(__dirname, '../dist'),
					filename: `[name]${suffix}.js`,
					libraryTarget: 'umd',
					library: {
						root: LIBRARY_NAMESPACE,
						amd: LIBRARY_NAMESPACE,
						commonjs: LIBRARY_NAME,
					},
					globalObject: 'this',
				},
				resolve: {
					extensions: moduleExtensions,
					modules: [
						path.resolve(__dirname, '..', 'reference'),
						'node_modules',
					],
				},
			},
			webpackConfBase
		),
		Object.assign(
			{
				entry: {
					[`${LIBRARY_FILENAME}.worker`]: path.resolve(
						__dirname,
						'../src/worker/index.ts'
					),
				},
				externals: {
					'js-synthesizer': 'JSSynth',
				},
				output: {
					path: path.resolve(__dirname, '../dist'),
					filename: `[name]${suffix}.js`,
				},
				resolve: {
					extensions: moduleExtensions,
					modules: [
						path.resolve(__dirname, '..', 'reference'),
						'node_modules',
					],
				},
			},
			webpackConfBase
		),
		Object.assign(
			{
				entry: {
					[`${LIBRARY_FILENAME}.worklet`]: path.resolve(
						__dirname,
						'../src/worklet/index.ts'
					),
				},
				externals: {
					'js-synthesizer': 'JSSynth',
				},
				output: {
					path: path.resolve(__dirname, '../dist'),
					filename: `[name]${suffix}.js`,
				},
				resolve: {
					extensions: moduleExtensions,
					modules: [
						path.resolve(__dirname, '..', 'reference'),
						'node_modules',
					],
				},
			},
			webpackConfBase
		),
	];
};
