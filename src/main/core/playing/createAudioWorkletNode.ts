import Options, { Defaults } from './Options';

/** @internal */
export default function createAudioWorkletNode(
	ctx: BaseAudioContext,
	options: Options
) {
	const rate = ctx.sampleRate;
	const prerenderFrames =
		rate *
		(typeof options.prerenderSeconds !== 'undefined'
			? options.prerenderSeconds
			: Defaults.PrerenderSeconds);
	const maxQueueFrames =
		rate *
		(typeof options.maxQueueSeconds !== 'undefined'
			? options.maxQueueSeconds
			: Defaults.MaxQueueSeconds);

	const node = new AudioWorkletNode(ctx, 'js-sequencer', {
		channelCount: 2,
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2],
		processorOptions: {
			options: { prerenderFrames, maxQueueFrames },
		},
	});

	return {
		node: node,
		port: node.port,
	};
}
