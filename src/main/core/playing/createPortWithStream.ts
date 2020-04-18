import * as RenderMessage from '../../types/RenderMessageData';

import IPlayStream from '../IPlayStream';

import Options from './Options';

/** @internal */
export default function createPortWithStream(
	stream: IPlayStream,
	sampleRate: number,
	options: Options
): MessagePort {
	const channel = new MessageChannel();
	const port = channel.port1;

	let isPaused = false;

	const listener = (e: MessageEvent) => {
		const data: RenderMessage.AllTypes = e.data;
		if (!data) {
			return;
		}
		switch (data.type) {
			case 'render':
				{
					stream.renderFrames(
						sampleRate,
						data.data[0],
						data.data[1],
						isPaused
					);
					const outFrames = data.data[0].byteLength / 4;
					{
						const s: RenderMessage.RenderedResponse = {
							type: 'rendered',
							data: {
								outFrames: outFrames,
								sampleRate: sampleRate,
								isQueueEmpty: true,
							},
						};
						port.postMessage(s);
					}
					{
						const s: RenderMessage.Status = {
							type: 'status',
							data: {
								outFrames: outFrames,
								sampleRate: sampleRate,
								isQueueEmpty: true,
							},
						};
						port.postMessage(s);
					}
				}
				break;
			case 'pause':
				isPaused = !!data.data.paused;
				if (stream.pauseStreaming) {
					stream.pauseStreaming(isPaused);
				}
				port.postMessage({
					type: 'pause',
					data: {
						id: data.data.id,
						paused: isPaused,
					},
				} as RenderMessage.Pause);
				break;
			case 'stop':
				if (stream.stopStreaming) {
					stream.stopStreaming();
				}
				isPaused = false;
				break;
			case 'release':
				if (stream.releaseStream) {
					stream.releaseStream();
				}
				port.removeEventListener('message', listener);
				port.close();
				break;
		}
	};

	port.addEventListener('message', listener);
	channel.port1.start();
	if (stream.startStreaming) {
		stream.startStreaming(sampleRate, options);
	}
	return channel.port2;
}
