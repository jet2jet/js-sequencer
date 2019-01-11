
import * as RenderMessage from 'types/RenderMessageData';

import IPlayStream from 'core/IPlayStream';

import Options from 'core/playing/Options';

/** @internal */
export default function createPortWithStream(stream: IPlayStream, sampleRate: number, options: Options): MessagePort {
	const channel = new MessageChannel();
	const port = channel.port1;

	const listener = (e: MessageEvent) => {
		const data: RenderMessage.AllTypes = e.data;
		if (!data) {
			return;
		}
		if (data.type === 'render') {
			stream.renderFrames(sampleRate, data.data[0], data.data[1]);
			const outFrames = data.data[0].byteLength / 4;
			{
				const s: RenderMessage.RenderedResponse = {
					type: 'rendered',
					data: {
						outFrames: outFrames,
						sampleRate: sampleRate,
						isQueueEmpty: true
					}
				};
				port.postMessage(s);
			}
			{
				const s: RenderMessage.Status = {
					type: 'status',
					data: {
						outFrames: outFrames,
						sampleRate: sampleRate,
						isQueueEmpty: true
					}
				};
				port.postMessage(s);
			}
		} else if (data.type === 'stop') {
			if (stream.stopStreaming) {
				stream.stopStreaming();
			}
		} else if (data.type === 'release') {
			if (stream.releaseStream) {
				stream.releaseStream();
			}
			port.removeEventListener('message', listener);
			port.close();
		}
	};

	port.addEventListener('message', listener);
	channel.port1.start();
	if (stream.startStreaming) {
		stream.startStreaming(sampleRate, options);
	}
	return channel.port2;
}
