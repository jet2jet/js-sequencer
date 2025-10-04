/// <reference types='audioworklet' />

import PlayerImpl, { type LibfluidsynthModule } from '../worker/PlayerImpl';
import makeDelayProcessRaw, {
	type DelayMillisecFunction,
	type CancelDelayMillisecFunction,
} from './core/makeDelayProcessRaw';
import FrameQueue from './core/playing/FrameQueue';
import { type AudioWorkletProcessorOptions } from './types/AudioWorkletTypes';
import type ITimer from './types/ITimer';
import type * as Message from './types/MessageData';
import type * as RenderMessage from './types/RenderMessageData';

type AudioWorkletGlobalScopeConstructorBase = typeof AudioWorkletGlobalScope;
interface AudioWorkletGlobalScopeConstructor
	extends AudioWorkletGlobalScopeConstructorBase {
	JSSynth?: typeof import('js-synthesizer');
	wasmModule?: LibfluidsynthModule;
}

interface TimerObject {
	timeout: number;
	callback: () => void;
}

class TimerContainer implements ITimer<TimerObject> {
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
	private prerenderFrames: number;
	private maxQueueFrames: number;
	private halfMaxQueueFrames: number;

	private renderedFrames: number;
	private statusFrames: number;
	private readonly delaySendRender: DelayMillisecFunction;
	private readonly cancelDelaySendRender: CancelDelayMillisecFunction;
	private readonly delaySendStatus: DelayMillisecFunction;
	private readonly cancelDelaySendStatus: CancelDelayMillisecFunction;

	private processData:
		| {
				player: PlayerImpl<TimerObject>;
				listeners: Array<(data: RenderMessage.AllTypes) => void>;
		  }
		| undefined;

	constructor(options: { processorOptions: AudioWorkletProcessorOptions }) {
		super();

		const timer = new TimerContainer(() => Date.now());
		this.timer = timer;

		const processorOptions = options.processorOptions;
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
				this.postRenderMessage(s);
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
				this.postRenderMessage(s);
			}
		);

		if (processorOptions.workletProcessMode) {
			this.port.addEventListener(
				'message',
				this.onPlayerMessage.bind(this)
			);
		} else {
			this.port.addEventListener(
				'message',
				this.onRenderMessage.bind(this)
			);
		}
		this.port.start();
	}

	public process(
		_inputs: Float32Array[][],
		outputs: Float32Array[][]
	): boolean {
		const frameCount = outputs[0][0].length;
		// const startTime = Date.now();
		this.timer.process();
		if (this.processData != null) {
			this.processData.player.render(frameCount);
		}

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
				this.postRenderMessage(msg);
			}
		);

		if (!this.isRendering) {
			if (queue.getFrameCountInQueue() <= this.halfMaxQueueFrames) {
				this.isRendering = true;
				const msg: RenderMessage.QueueControl = {
					type: 'queue',
					data: { pause: false },
				};
				this.postRenderMessage(msg);
			}
		}

		if (frames) {
			this.statusFrames += frames;
			this.delaySendStatus(250);
		}

		// console.log(`[worklet] process took ${Date.now() - startTime}ms`);

		return true;
	}

	private cleanup() {
		this.cancelDelaySendRender();
		this.cancelDelaySendStatus();
		this.port.close();
	}

	private postRenderMessage(msg: RenderMessage.AllTypes) {
		// console.log(
		// 	`[worklet] postRenderMessage type = ${msg.type}, listeners = ${this.processData?.listeners.length}`
		// );
		if (this.processData != null) {
			for (const l of this.processData.listeners) {
				l(msg);
			}
		} else {
			this.port.postMessage(msg);
		}
	}

	private onPlayerMessage(e: MessageEvent) {
		const data = e.data as unknown as Message.AllTypes | null | undefined;
		if (!data) {
			return;
		}
		switch (data.type) {
			case 'initialize': {
				const g =
					AudioWorkletGlobalScope as AudioWorkletGlobalScopeConstructor;
				if (g.JSSynth == null || g.wasmModule == null) {
					throw new Error(
						'Worklet module of js-synthesizer is not loaded.'
					);
				}
				const listeners: NonNullable<
					typeof this.processData
				>['listeners'] = [];
				const player = new PlayerImpl(
					this.timer,
					data,
					true,
					{
						addMessageListener: (listener) => {
							listeners.push(listener);
							return () => {
								const i = listeners.indexOf(listener);
								if (i >= 0) {
									listeners.splice(i, 1);
								}
							};
						},
						onMessage: (data) => this.onRenderMessageImpl(data),
					},
					g.JSSynth,
					g.wasmModule
				);
				this.queue.clear();
				this.isRendering = true;
				this.processData = {
					player,
					listeners,
				};
				break;
			}
			case 'set-play-options': {
				this.prerenderFrames = data.prerenderFrames;
				this.maxQueueFrames = data.maxQueueFrames;
				this.halfMaxQueueFrames = Math.floor(
					(this.maxQueueFrames * 3) / 2
				);
				break;
			}
		}
	}

	private onRenderMessage(e: MessageEvent) {
		const data: RenderMessage.AllTypes | null | undefined =
			e.data as unknown as RenderMessage.AllTypes | null | undefined;
		if (!data || !('type' in data)) {
			return;
		}
		this.onRenderMessageImpl(data);
	}

	private onRenderMessageImpl(data: RenderMessage.AllTypes) {
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
						this.postRenderMessage(msg);
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
					this.postRenderMessage(msg);
				}
				break;
			case 'stop':
				this.queue.clear();
				this.isPaused = false;
				this.isPrerendering = true;
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
