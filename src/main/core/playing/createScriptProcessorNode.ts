import * as RenderMessage from '../../types/RenderMessageData';
import makeDelayProcess from '../makeDelayProcess';
import FrameQueue from './FrameQueue';
import Options, { Defaults } from './Options';

/** @internal */
export default function createScriptProcessorNode(
	ctx: BaseAudioContext,
	renderFrameCount: number,
	options: Options
): { node: ScriptProcessorNode; port: MessagePort } {
	{
		let x = 0;
		while (renderFrameCount) {
			++x;
			renderFrameCount >>= 1;
		}
		while (x) {
			--x;
			renderFrameCount = renderFrameCount ? renderFrameCount << 1 : 1;
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
	const halfMaxQueueFrames = Math.floor((maxQueueFrames * 2) / 3);

	const frameBuffers: [Float32Array, Float32Array] = [
		new Float32Array(renderFrameCount),
		new Float32Array(renderFrameCount),
	];

	let isPrerendering = true;
	let isRendering = true;
	let isPaused = false;

	let renderedFrames = 0;
	const [delaySendRender, cancelDelaySendRender] = makeDelayProcess(() => {
		const s: RenderMessage.RenderedResponse = {
			type: 'rendered',
			data: {
				outFrames: renderedFrames,
				sampleRate: rate,
				isQueueEmpty: false,
			},
		};
		renderedFrames = 0;
		try {
			port1.postMessage(s);
		} catch {}
	});
	const [delaySendStatus, cancelDelaySendStatus] = makeDelayProcess(() => {
		const s: RenderMessage.Status = {
			type: 'status',
			data: {
				outFrames: proceededFrames,
				sampleRate: rate,
				isQueueEmpty: queue.isEmpty(),
			},
		};
		proceededFrames = 0;
		try {
			port1.postMessage(s);
		} catch {}
	});

	const listener = (e: MessageEvent) => {
		const data: RenderMessage.AllTypes | null | undefined =
			e.data as unknown as RenderMessage.AllTypes | null | undefined;
		if (!data) {
			return;
		}
		switch (data.type) {
			case 'render':
				queue.pushFrames(data.data);
				if (isPrerendering) {
					if (queue.getFrameCountInQueue() >= prerenderFrames) {
						// console.log('Prerender finished', queue.getFrameCountInQueue());
						isPrerendering = false;
					}
				}

				renderedFrames += data.data[0].byteLength / 4;
				delaySendRender(250);

				if (
					isRendering &&
					queue.getFrameCountInQueue() >= maxQueueFrames
				) {
					isRendering = false;
					const msg: RenderMessage.QueueControl = {
						type: 'queue',
						data: { pause: true },
					};
					port1.postMessage(msg);
				}
				break;
			case 'pause':
				{
					isPaused = !!data.data.paused;
					const msg: RenderMessage.Pause = {
						type: 'pause',
						data: {
							id: data.data.id,
							paused: isPaused,
						},
					};
					port1.postMessage(msg);
				}
				break;
			case 'stop':
				queue.clear();
				frameBuffers[0].fill(0);
				frameBuffers[1].fill(0);
				isPaused = false;
				break;
			case 'release':
				cancelDelaySendRender();
				cancelDelaySendStatus();
				port1.removeEventListener('message', listener);
				port1.close();
				break;
			case 'user-marker-send':
				queue.pushMarker(data.data);
				break;
		}
	};

	port1.addEventListener('message', listener);
	port1.start();

	let proceededFrames = 0;

	node.onaudioprocess = (e) => {
		if (isPrerendering || isPaused) {
			frameBuffers[0].fill(0);
			frameBuffers[1].fill(0);
			e.outputBuffer.copyToChannel(frameBuffers[0], 0);
			e.outputBuffer.copyToChannel(frameBuffers[1], 1);
			return;
		}

		const frames = queue.outputFrames(
			frameBuffers,
			(marker, framesBeforeMarker) => {
				const msg: RenderMessage.UserMarkerResponse = {
					type: 'user-marker-resp',
					data: {
						marker,
						framesBeforeMarker,
						sampleRate: rate,
					},
				};
				port1.postMessage(msg);
			}
		);

		if (!isRendering) {
			if (queue.getFrameCountInQueue() <= halfMaxQueueFrames) {
				isRendering = true;
				const msg: RenderMessage.QueueControl = {
					type: 'queue',
					data: { pause: false },
				};
				port1.postMessage(msg);
			}
		}

		if (!frames) {
			e.outputBuffer.copyToChannel(frameBuffers[0], 0);
			e.outputBuffer.copyToChannel(frameBuffers[1], 1);
			return;
		}
		if (frames < frameBuffers[0].length) {
			e.outputBuffer.copyToChannel(
				frameBuffers[0].subarray(0, frames),
				0
			);
			e.outputBuffer.copyToChannel(
				frameBuffers[1].subarray(0, frames),
				1
			);
		} else {
			e.outputBuffer.copyToChannel(frameBuffers[0], 0);
			e.outputBuffer.copyToChannel(frameBuffers[1], 1);
		}

		proceededFrames += frames;
		delaySendStatus(250);
	};

	return {
		node,
		port: port2,
	};
}
