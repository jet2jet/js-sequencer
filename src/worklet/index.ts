/// <reference types='AudioWorklet' />

import makeDelayProcessRaw, {
	type DelayMillisecFunction,
	type CancelDelayMillisecFunction,
} from './core/makeDelayProcessRaw';
import FrameQueue from './core/playing/FrameQueue';
import { type AudioWorkletProcessorOptions } from './types/AudioWorkletTypes';
import type * as RenderMessage from './types/RenderMessageData';

interface TimerObject {
	timeout: number;
	callback: () => void;
}

class TimerContainer {
	private readonly timers: TimerObject[] = [];

	constructor(private readonly getTime: (this: unknown) => number) {}

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
	private readonly queue = new FrameQueue();

	private readonly timer: TimerContainer;

	private isPrerendering = true;
	private isPaused = false;
	private isRendering = true;
	private readonly prerenderFrames: number;
	private readonly maxQueueFrames: number;
	private readonly halfMaxQueueFrames: number;

	private renderedFrames: number;
	private statusFrames: number;
	private readonly delaySendRender: DelayMillisecFunction;
	private readonly cancelDelaySendRender: CancelDelayMillisecFunction;
	private readonly delaySendStatus: DelayMillisecFunction;
	private readonly cancelDelaySendStatus: CancelDelayMillisecFunction;

	constructor(options: AudioWorkletNodeOptions) {
		super(options);

		const timer = new TimerContainer(() => Date.now());
		this.timer = timer;

		const processorOptions =
			options.processorOptions as AudioWorkletProcessorOptions;
		this.prerenderFrames = processorOptions.options.prerenderFrames;
		this.maxQueueFrames = processorOptions.options.maxQueueFrames;
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
						sampleRate,
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
						sampleRate,
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
				const msg: RenderMessage.UserMarkerResponse = {
					type: 'user-marker-resp',
					data: {
						marker,
						framesBeforeMarker,
						sampleRate,
					},
				};
				this.port.postMessage(msg);
			}
		);

		if (!this.isRendering) {
			if (queue.getFrameCountInQueue() <= this.halfMaxQueueFrames) {
				this.isRendering = true;
				const msg: RenderMessage.QueueControl = {
					type: 'queue',
					data: { pause: false },
				};
				this.port.postMessage(msg);
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
		const data: RenderMessage.AllTypes | null | undefined =
			e.data as unknown as RenderMessage.AllTypes | null | undefined;
		if (!data || !('type' in data)) {
			return;
		}
		switch (data.type) {
			case 'render':
				{
					const queue = this.queue;
					const pushedFrameCount = queue.pushFrames(data.data);
					if (this.isPrerendering) {
						if (
							queue.getFrameCountInQueue() >= this.prerenderFrames
						) {
							this.isPrerendering = false;
						}
					}

					this.renderedFrames += pushedFrameCount;
					this.delaySendRender(250);

					if (
						this.isRendering &&
						queue.getFrameCountInQueue() >= this.maxQueueFrames
					) {
						this.isRendering = false;
						const msg: RenderMessage.QueueControl = {
							type: 'queue',
							data: { pause: true },
						};
						this.port.postMessage(msg);
					}
				}
				break;
			case 'pause':
				{
					this.isPaused = !!data.data.paused;
					const msg: RenderMessage.Pause = {
						type: 'pause',
						data: {
							id: data.data.id,
							paused: this.isPaused,
						},
					};
					this.port.postMessage(msg);
				}
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
