/// <reference types='AudioWorklet' />

import * as RenderMessage from 'types/RenderMessageData';

import FrameQueue from 'core/playing/FrameQueue';

class Processor extends AudioWorkletProcessor {

	private queue = new FrameQueue();

	private isPrerendering = true;
	private isPaused = false;
	private isRendering = true;
	private prerenderFrames: number;
	private maxQueueFrames: number;
	private halfMaxQueueFrames: number;

	constructor(options: AudioWorkletNodeOptions) {
		super(options);

		this.prerenderFrames = options.processorOptions!.options.prerenderFrames;
		this.maxQueueFrames = options.processorOptions!.options.maxQueueFrames;
		this.halfMaxQueueFrames = Math.floor(this.maxQueueFrames * 3 / 2);

		this.port.addEventListener('message', this.onMessage.bind(this));
		this.port.start();
	}

	public process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		if (this.isPrerendering || this.isPaused) {
			return true;
		}

		const queue = this.queue;
		const frames = queue.outputFrames(outputs[0] as [Float32Array, Float32Array]);

		if (!this.isRendering) {
			if (queue.getFrameCountInQueue() <= this.halfMaxQueueFrames) {
				this.isRendering = true;
				this.port.postMessage({
					type: 'queue',
					data: { pause: false }
				} as RenderMessage.QueueControl);
			}
		}

		if (frames) {
			const s: RenderMessage.Status = {
				type: 'status',
				data: {
					outFrames: frames,
					sampleRate: sampleRate,
					isQueueEmpty: queue.isEmpty()
				}
			};
			this.port.postMessage(s);
		}
		return true;
	}

	private onMessage(e: MessageEvent) {
		const data: RenderMessage.AllTypes = e.data;
		if (!data) {
			return;
		}
		switch (data.type) {
			case 'render':
				{
					const queue = this.queue;
					queue.pushFrames(data.data);
					if (this.isPrerendering) {
						if (queue.getFrameCountInQueue() >= this.prerenderFrames) {
							this.isPrerendering = false;
						}
					}

					const s: RenderMessage.RenderedResponse = {
						type: 'rendered',
						data: {
							outFrames: data.data[0].byteLength / 4,
							sampleRate: sampleRate,
							isQueueEmpty: false
						}
					};
					this.port.postMessage(s);

					if (queue.getFrameCountInQueue() >= this.maxQueueFrames) {
						this.isRendering = false;
						this.port.postMessage({
							type: 'queue',
							data: { pause: true }
						} as RenderMessage.QueueControl);
					}
				}
				break;
			case 'pause':
				this.isPaused = !!data.data.paused;
				this.port.postMessage({
					type: 'pause',
					data: {
						id: data.data.id,
						paused: this.isPaused
					}
				} as RenderMessage.Pause);
				break;
			case 'stop':
				this.queue.clear();
				this.isPaused = false;
				break;
			case 'release':
				this.port.close();
				break;
		}
	}
}

registerProcessor('js-sequencer', Processor);
