
import * as RenderMessage from '../../types/RenderMessageData';

import FrameQueue from './FrameQueue';
import Options, { Defaults } from './Options';

/** @internal */
export default function createScriptProcessorNode(ctx: BaseAudioContext, renderFrameCount: number, options: Options) {
	{
		let x = 0;
		while (renderFrameCount) {
			++x;
			renderFrameCount >>= 1;
		}
		while (x) {
			--x;
			renderFrameCount = renderFrameCount ? (renderFrameCount << 1) : 1;
		}
		if (renderFrameCount < 512) {
			renderFrameCount = 512;
		}
	}

	const channel = new MessageChannel();
	const port1 = channel.port1;
	const port2 = channel.port2;
	const queue = new FrameQueue();
	const node = ctx.createScriptProcessor(renderFrameCount, 0, 2);
	const rate = ctx.sampleRate;
	const prerenderFrames = rate * ((typeof options.prerenderSeconds !== 'undefined') ?
		options.prerenderSeconds : Defaults.PrerenderSeconds);
	const maxQueueFrames = rate * ((typeof options.maxQueueSeconds !== 'undefined') ?
		options.maxQueueSeconds : Defaults.MaxQueueSeconds);
	const halfMaxQueueFrames = Math.floor(maxQueueFrames * 2 / 3);

	const frameBuffers: [Float32Array, Float32Array] = [
		new Float32Array(renderFrameCount),
		new Float32Array(renderFrameCount)
	];

	let isPrerendering = true;
	let isRendering = true;
	let isPaused = false;

	const listener = (e: MessageEvent) => {
		const data: RenderMessage.AllTypes = e.data;
		if (!data) {
			return;
		}
		switch (data.type) {
			case 'render':
				{
					queue.pushFrames(data.data);
					if (isPrerendering) {
						if (queue.getFrameCountInQueue() >= prerenderFrames) {
							// console.log('Prerender finished', queue.getFrameCountInQueue());
							isPrerendering = false;
						}
					}

					const s: RenderMessage.RenderedResponse = {
						type: 'rendered',
						data: {
							outFrames: data.data[0].byteLength / 4,
							sampleRate: rate,
							isQueueEmpty: false
						}
					};
					port1.postMessage(s);

					if (queue.getFrameCountInQueue() >= maxQueueFrames) {
						isRendering = false;
						port1.postMessage({
							type: 'queue',
							data: { pause: true }
						} as RenderMessage.QueueControl);
					}
				}
				break;
			case 'pause':
				isPaused = !!data.data.paused;
				port1.postMessage({
					type: 'pause',
					data: {
						id: data.data.id,
						paused: isPaused
					}
				} as RenderMessage.Pause);
				break;
			case 'stop':
				queue.clear();
				frameBuffers[0].fill(0);
				frameBuffers[1].fill(0);
				isPaused = false;
				break;
			case 'release':
				port1.removeEventListener('message', listener);
				port1.close();
				break;
		}
	};

	port1.addEventListener('message', listener);
	port1.start();

	node.onaudioprocess = (e) => {
		if (isPrerendering || isPaused) {
			frameBuffers[0].fill(0);
			frameBuffers[1].fill(0);
			e.outputBuffer.copyToChannel(frameBuffers[0], 0);
			e.outputBuffer.copyToChannel(frameBuffers[1], 1);
			return;
		}

		const frames = queue.outputFrames(frameBuffers);

		if (!isRendering) {
			if (queue.getFrameCountInQueue() <= halfMaxQueueFrames) {
				isRendering = true;
				port1.postMessage({
					type: 'queue',
					data: { pause: false }
				} as RenderMessage.QueueControl);
			}
		}

		if (!frames) {
			e.outputBuffer.copyToChannel(frameBuffers[0], 0);
			e.outputBuffer.copyToChannel(frameBuffers[1], 1);
			return;
		}
		if (frames < frameBuffers[0].length) {
			e.outputBuffer.copyToChannel(frameBuffers[0].subarray(0, frames), 0);
			e.outputBuffer.copyToChannel(frameBuffers[1].subarray(0, frames), 1);
		} else {
			e.outputBuffer.copyToChannel(frameBuffers[0], 0);
			e.outputBuffer.copyToChannel(frameBuffers[1], 1);
		}

		const s: RenderMessage.Status = {
			type: 'status',
			data: {
				outFrames: frames,
				sampleRate: rate,
				isQueueEmpty: queue.isEmpty()
			}
		};
		port1.postMessage(s);
	};

	return {
		node: node,
		port: port2
	};
}
