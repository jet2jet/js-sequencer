/// <reference types='AudioWorklet' />

import * as RenderMessage from './types/RenderMessageData';

import FrameQueue from './core/playing/FrameQueue';

import makeDelayProcessRaw, {
	DelayMillisecFunction,
	CancelDelayMillisecFunction,
} from './core/makeDelayProcessRaw';

interface TimerObject {
	timeout: number;
	callback: () => void;
}

class TimerContainer {
	private timers: TimerObject[] = [];

	constructor(private getTime: (this: unknown) => number) {}

	public process() {
		const timers = this.timers;
		let i = 0;
		while (i < timers.length) {
			const t = timers[i];
			if (this.getTime() >= t.timeout) {
				const callback = t.callback;
				timers.splice(i, 1);
				callback();
			} else {
				++i;
			}
		}
	}

	public set(cb: () => void, millisec: number) {
		const t: TimerObject = {
			callback: cb,
			timeout: this.getTime() + millisec,
		};
		this.timers.push(t);
		return t;
	}

	public clear(t: TimerObject) {
		const i = this.timers.indexOf(t);
		if (i >= 0) {
			this.timers.splice(i, 1);
		}
	}
}

class Processor extends AudioWorkletProcessor {
	private queue = new FrameQueue();

	private timer: TimerContainer;

	private isPrerendering = true;
	private isPaused = false;
	private isRendering = true;
	private prerenderFrames: number;
	private maxQueueFrames: number;
	private halfMaxQueueFrames: number;

	private renderedFrames: number;
	private statusFrames: number;
	private delaySendRender: DelayMillisecFunction;
	private cancelDelaySendRender: CancelDelayMillisecFunction;
	private delaySendStatus: DelayMillisecFunction;
	private cancelDelaySendStatus: CancelDelayMillisecFunction;

	constructor(options: AudioWorkletNodeOptions) {
		super(options);

		const timer = new TimerContainer(() => Date.now());
		this.timer = timer;

		this.prerenderFrames =
			options.processorOptions!.options.prerenderFrames;
		this.maxQueueFrames = options.processorOptions!.options.maxQueueFrames;
		this.halfMaxQueueFrames = Math.floor((this.maxQueueFrames * 3) / 2);

		const makeDelayProcess = (() => {
			const fnSetTimeout = timer.set.bind(timer);
			const fnClearTimeout = timer.clear.bind(timer);
			return (callback: () => void) => {
				return makeDelayProcessRaw(
					callback,
					fnSetTimeout,
					fnClearTimeout
				);
			};
		})();

		this.renderedFrames = 0;
		this.statusFrames = 0;
		[this.delaySendRender, this.cancelDelaySendRender] = makeDelayProcess(
			() => {
				const r = this.renderedFrames;
				this.renderedFrames = 0;
				const s: RenderMessage.RenderedResponse = {
					type: 'rendered',
					data: {
						outFrames: r,
						sampleRate: sampleRate,
						isQueueEmpty: false,
					},
				};
				this.port.postMessage(s);
			}
		);
		[this.delaySendStatus, this.cancelDelaySendStatus] = makeDelayProcess(
			() => {
				const r = this.statusFrames;
				this.statusFrames = 0;
				const s: RenderMessage.Status = {
					type: 'status',
					data: {
						outFrames: r,
						sampleRate: sampleRate,
						isQueueEmpty: false,
					},
				};
				this.port.postMessage(s);
			}
		);

		this.port.addEventListener('message', this.onMessage.bind(this));
		this.port.start();
	}

	public process(
		_inputs: Float32Array[][],
		outputs: Float32Array[][]
	): boolean {
		this.timer.process();

		if (this.isPrerendering || this.isPaused) {
			return true;
		}

		const queue = this.queue;
		const frames = queue.outputFrames(
			outputs[0] as [Float32Array, Float32Array],
			(marker, framesBeforeMarker) => {
				this.port.postMessage({
					type: 'user-marker-resp',
					data: {
						marker,
						framesBeforeMarker,
						sampleRate: sampleRate,
					},
				} as RenderMessage.UserMarkerResponse);
			}
		);

		if (!this.isRendering) {
			if (queue.getFrameCountInQueue() <= this.halfMaxQueueFrames) {
				this.isRendering = true;
				this.port.postMessage({
					type: 'queue',
					data: { pause: false },
				} as RenderMessage.QueueControl);
			}
		}

		if (frames) {
			this.statusFrames += frames;
			this.delaySendStatus(250);
		}
		return true;
	}

	private cleanup() {
		this.cancelDelaySendRender();
		this.cancelDelaySendStatus();
		this.port.close();
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
						if (
							queue.getFrameCountInQueue() >= this.prerenderFrames
						) {
							this.isPrerendering = false;
						}
					}

					const frames = data.data[0].byteLength / 4;
					this.renderedFrames += frames;
					this.delaySendRender(250);

					if (
						this.isRendering &&
						queue.getFrameCountInQueue() >= this.maxQueueFrames
					) {
						this.isRendering = false;
						this.port.postMessage({
							type: 'queue',
							data: { pause: true },
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
						paused: this.isPaused,
					},
				} as RenderMessage.Pause);
				break;
			case 'stop':
				this.queue.clear();
				this.isPaused = false;
				break;
			case 'release':
				this.cleanup();
				break;
			case 'user-marker-send':
				this.queue.pushMarker(data.data);
				break;
		}
	}
}

registerProcessor('js-sequencer', Processor);
