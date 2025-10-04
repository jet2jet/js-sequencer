import type * as JSSynth from 'js-synthesizer';
import { type AudioWorkletProcessorOptions } from '../../types/AudioWorkletTypes';
import type * as Message from '../../types/MessageData';
import type * as RenderMessage from '../../types/RenderMessageData';
import type * as Response from '../../types/ResponseData';
import type IPlayStream from '../IPlayStream';
import createAudioWorkletNode from './createAudioWorkletNode';
import createPortWithStream from './createPortWithStream';
import createScriptProcessorNode from './createScriptProcessorNode';
import type Options from './Options';
import { Defaults } from './Options';

declare global {
	interface BaseAudioContext {
		renderQuantumSize?: number;
	}
}

type ResponseDataTypeBase<
	TType extends Response.AllTypes['type'],
	TResponseType extends Response.AllTypes,
> = TResponseType extends { type: TType } ? TResponseType['data'] : never;
type ResponseDataType<TType extends Response.AllTypes['type']> =
	ResponseDataTypeBase<TType, Response.AllTypes>;

let _workerShared: Worker | undefined;

function promiseWithTimeout<T>(
	promise: Promise<T>,
	timeoutMilliseconds: number
) {
	return new Promise<T>((resolve, reject) => {
		let resolved = false;
		const id = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				reject(new Error('timeout'));
			}
		}, timeoutMilliseconds);
		promise.then(
			(r) => {
				if (!resolved) {
					clearTimeout(id);
					resolved = true;
					resolve(r);
				}
			},
			(e) => {
				if (!resolved) {
					clearTimeout(id);
					resolved = true;
					reject(e);
				}
			}
		);
	});
}

/** @internal */
export default class PlayerProxy {
	public onQueued: null | ((status: RenderMessage.StatusData) => void);
	public onStatus: null | ((status: RenderMessage.StatusData) => void);
	public onStop: null | (() => void);
	public onReset: null | (() => void);
	public onUserData: null | ((data: any) => void);
	public onUserMarker: null | ((data: RenderMessage.UserMarkerData) => void);

	private playingId: number = 0;
	private stopPromise: Promise<void>;
	private stopResolver: null | (() => void);

	private msgId: number;
	private readonly defers: Array<{
		id: number;
		type: Response.AllTypes['type'];
		resolve(data?: any): void;
	}>;
	private userEventData: {
		[key: string]: { data: any } | undefined;
	} = {};
	private userEventId: number = 0;

	private audioWorkletNode: AudioWorkletNode | undefined;

	private constructor(
		private readonly port: MessagePort,
		private framesCount: number,
		public readonly sampleRate: number
	) {
		this.stopPromise = Promise.resolve();
		this.stopResolver = null;
		this.msgId = 1;
		this.defers = [];
		this.onQueued = null;
		this.onStatus = null;
		this.onStop = null;
		this.onReset = null;
		this.onUserData = null;
		this.onUserMarker = null;
		port.addEventListener('message', this.onMessage.bind(this));
		port.start();
	}

	public static instantiate(
		shareWorker: boolean | undefined,
		workerJs: string,
		depsJs: string[],
		interval: number,
		framesCount: number,
		sampleRate: number,
		channelCount?: number
	): Promise<PlayerProxy> {
		const newWorker = !(shareWorker && _workerShared);
		const worker = newWorker ? new Worker(workerJs) : _workerShared!;
		const channel = new MessageChannel();
		const proxy = new PlayerProxy(channel.port1, framesCount, sampleRate);

		if (shareWorker && newWorker) {
			_workerShared = worker;
		}

		const initData: Message.Initialize = {
			id: 0,
			type: 'initialize',
			deps: newWorker ? depsJs : [],
			port: channel.port2,
			interval,
			sampleRate,
			channelCount,
		};
		const ret = proxy.addDefer(0, 'initialize').then(() => proxy);
		worker.postMessage(initData, [channel.port2]);
		return ret;
	}

	public static instantiateWithAudioWorklet(
		audioContext: BaseAudioContext,
		playOptions: Options,
		interval: number,
		framesCount: number,
		sampleRate: number,
		channelCount?: number
	): Promise<PlayerProxy> {
		const prerenderFrames =
			sampleRate *
			(typeof playOptions.prerenderSeconds !== 'undefined'
				? playOptions.prerenderSeconds
				: Defaults.PrerenderSeconds);
		const maxQueueFrames =
			sampleRate *
			(typeof playOptions.maxQueueSeconds !== 'undefined'
				? playOptions.maxQueueSeconds
				: Defaults.MaxQueueSeconds);

		const audioWorkletNode = new AudioWorkletNode(
			audioContext,
			'js-sequencer',
			{
				channelCount: 2,
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				processorOptions: {
					options: {
						prerenderFrames,
						maxQueueFrames,
					},
					workletProcessMode: true,
				} satisfies AudioWorkletProcessorOptions,
			}
		);
		const channel = new MessageChannel();
		const proxy = new PlayerProxy(channel.port1, framesCount, sampleRate);

		const initData: Message.Initialize = {
			id: 0,
			type: 'initialize',
			deps: [],
			port: channel.port2,
			interval,
			sampleRate,
			channelCount,
		};
		const ret = proxy.addDefer(0, 'initialize').then(() => proxy);
		audioWorkletNode.port.postMessage(initData, [channel.port2]);
		proxy.audioWorkletNode = audioWorkletNode;
		return ret;
	}

	private postMessage(
		message: Message.AllTypes,
		transferable?: Transferable[]
	) {
		console.log(`[PlayerProxy] postMessage: type = ${message.type}`);
		const p = this.port;
		transferable
			? p.postMessage(message, transferable)
			: p.postMessage(message);
	}

	public close(): void {
		const data: Message.Close = {
			type: 'close',
		};
		this.postMessage(data);
		this.port.close();
		if (this.audioWorkletNode) {
			this.audioWorkletNode.disconnect();
			this.audioWorkletNode = void 0;
		}
	}

	public isWorkletMode(): boolean {
		return this.audioWorkletNode != null;
	}

	public setPlayOptions(options: Readonly<Options>): void {
		if (this.audioWorkletNode != null) {
			const prerenderFrames =
				this.sampleRate *
				(typeof options.prerenderSeconds !== 'undefined'
					? options.prerenderSeconds
					: Defaults.PrerenderSeconds);
			const maxQueueFrames =
				this.sampleRate *
				(typeof options.maxQueueSeconds !== 'undefined'
					? options.maxQueueSeconds
					: Defaults.MaxQueueSeconds);

			const data: Message.SetPlayOptions = {
				type: 'set-play-options',
				prerenderFrames,
				maxQueueFrames,
			};
			this.audioWorkletNode.port.postMessage(data);
		}
	}

	public loadSoundfont(bin: ArrayBuffer): Promise<number> {
		const data: Message.LoadSoundfont = {
			id: this.msgId++,
			type: 'load-sfont',
			data: bin,
		};
		const ret = this.addDefer(data.id, 'load-sfont');
		this.postMessage(data);
		return ret;
	}

	public unloadSoundfont(sfontId: number): Promise<void> {
		const data: Message.UnloadSoundfont = {
			id: this.msgId++,
			type: 'unload-sfont',
			sfontId,
		};
		const ret: Promise<void> = this.addDefer(data.id, 'unload-sfont');
		this.postMessage(data);
		return ret;
	}

	public configure(config: Message.ConfigBase): Promise<void> {
		if (typeof config.framesCount === 'number') {
			this.framesCount = config.framesCount;
		}

		const data: Message.Configure = {
			...config,
			id: this.msgId++,
			type: 'config',
		};
		const ret: Promise<void> = this.addDefer(data.id, 'config');
		this.postMessage(data);
		return ret;
	}

	public startWithScriptProcessorNode(
		ctx: BaseAudioContext,
		sfontDefault: number,
		options: Options
	): ScriptProcessorNode {
		const r = createScriptProcessorNode(ctx, this.framesCount, options);
		this.startImpl(r.port, sfontDefault, null);
		return r.node;
	}

	public startWithAudioWorkletNode(
		ctx: BaseAudioContext,
		sfontDefault: number,
		options: Options
	): AudioWorkletNode {
		if (this.audioWorkletNode) {
			this.startImpl(void 0, sfontDefault, ctx.renderQuantumSize || 128);
			return this.audioWorkletNode;
		}
		const r = createAudioWorkletNode(ctx, options);
		// For Audio Worklet, we strictly use renderQuantumSize
		this.startImpl(r.port, sfontDefault, ctx.renderQuantumSize || 128);
		return r.node;
	}

	public startForStream(
		stream: IPlayStream,
		sfontDefault: number,
		options: Options
	): void {
		const port = createPortWithStream(stream, this.sampleRate, options);
		this.startImpl(port, sfontDefault, null);
	}

	public startWithExistingConnection(sfontDefault: number): void {
		const data: Message.Start = {
			type: 'start',
			sfontDefault,
			playingId: this.initPlayingId(),
			renderQuantumSize: null,
		};
		this.postMessage(data);
		this.stopPromise = new Promise((resolve) => {
			this.stopResolver = resolve;
		});
	}

	private startImpl(
		renderPort: MessagePort | undefined,
		sfontDefault: number,
		renderQuantumSize: number | null
	) {
		const data: Message.Start = {
			type: 'start',
			playingId: this.initPlayingId(),
			sfontDefault,
			renderQuantumSize,
			renderPort,
		};
		this.postMessage(data, renderPort ? [renderPort] : []);
		this.stopPromise = new Promise((resolve) => {
			this.stopResolver = resolve;
		});
	}

	public pause(isPaused: boolean): Promise<ResponseDataType<'pause'>> {
		const data: Message.Pause = {
			id: this.msgId++,
			type: 'pause',
			paused: isPaused,
		};
		const ret = this.addDefer(data.id, 'pause');
		this.postMessage(data);
		return ret;
	}

	public stop(): void {
		const msg: Message.Stop = { type: 'stop' };
		this.postMessage(msg);
	}

	public resetTime(): void {
		const msg: Message.ResetTime = { type: 'reset-time' };
		this.postMessage(msg);
	}

	public releasePlayer(resetSynth?: boolean): void {
		const msg: Message.Release = {
			type: 'release',
			resetSynth,
		};
		this.postMessage(msg);
	}

	public waitForFinish(timeoutMilliseconds?: number): Promise<void> {
		if (typeof timeoutMilliseconds === 'number') {
			return promiseWithTimeout(
				this.stopPromise,
				timeoutMilliseconds
			).catch(() => {
				this.doStop();
			});
		} else {
			return this.stopPromise;
		}
	}

	public sendEvent(eventData: JSSynth.SequencerEvent, time: number): void {
		const data: Message.Event = {
			type: 'event',
			time,
			data: eventData,
		};
		this.postMessage(data);
	}

	public sendEventNow(eventData: JSSynth.SequencerEvent): void {
		const data: Message.Event = {
			type: 'event',
			time: null,
			data: eventData,
		};
		this.postMessage(data);
	}

	public sendEvents(
		events: Array<[JSSynth.SequencerEvent, number | null]>
	): void {
		const data: Message.Events = {
			type: 'events',
			data: events,
		};
		this.postMessage(data);
	}

	public sendSysEx(bin: Uint8Array, time: number): void {
		const data: Message.SysEx = {
			type: 'sysex',
			time,
			data: bin.slice(0).buffer,
		};
		this.postMessage(data, [data.data]);
	}

	public sendSysExNow(bin: Uint8Array): void {
		const data: Message.SysEx = {
			type: 'sysex',
			time: null,
			data: bin.slice(0).buffer,
		};
		this.postMessage(data, [data.data]);
	}

	public sendGeneratorValue(
		channel: number,
		type: JSSynth.Constants.GeneratorTypes,
		value: number | null,
		keepCurrentVoice: boolean | null | undefined,
		time: number
	): void {
		const data: Message.Generator = {
			type: 'gen',
			time,
			data: {
				channel,
				type,
				value,
				keepCurrentVoice,
			},
		};
		this.postMessage(data);
	}

	public sendGeneratorValueNow(
		channel: number,
		type: JSSynth.Constants.GeneratorTypes,
		value: number | null,
		keepCurrentVoice: boolean | null | undefined
	): void {
		const data: Message.Generator = {
			type: 'gen',
			time: null,
			data: {
				channel,
				type,
				value,
				keepCurrentVoice,
			},
		};
		this.postMessage(data);
	}

	public sendUserData(userData: unknown, time: number): void {
		const id = this.userEventId++;
		const text = `ud-${id}`;
		this.userEventData[text] = { data: userData };
		const data: Message.UserEvent = {
			type: 'user-event',
			time,
			data: text,
		};
		this.postMessage(data);
	}

	public sendFinishMarker(time: number): void {
		const data: Message.FinishMarker = {
			type: 'finish',
			time,
		};
		this.postMessage(data);
	}

	public sendFinishMarkerNow(): void {
		const data: Message.FinishMarker = {
			type: 'finish',
			time: null,
		};
		this.postMessage(data);
	}

	public sendUserMarker(time: number, marker: string): void {
		const data: Message.UserMarker = {
			type: 'user-marker',
			time,
			marker,
		};
		this.postMessage(data);
	}

	private initPlayingId(): number {
		return ++this.playingId;
	}

	private addDefer<TType extends Response.AllTypes['type']>(
		id: number,
		type: TType
	) {
		return new Promise<ResponseDataType<TType>>((resolve) => {
			this.defers.push({
				id,
				type,
				resolve,
			});
		});
	}

	private onMessage(e: MessageEvent) {
		const data: Response.AllTypes | null | undefined = e.data as unknown as
			| Response.AllTypes
			| null
			| undefined;
		if (!data) {
			return;
		}
		console.log(`[PlayerProxy] onMessage: type = ${data.type}`);
		switch (data.type) {
			case 'stop':
				if (data.data === this.playingId) {
					// console.log('[PlayerProxy] stop');
					this.doStop();
				} else {
					// console.log('[PlayerProxy] ignore stop: different playingId: ', data.data, 'vs.', this.playingId);
				}
				break;
			case 'rendered':
				// console.log('[PlayerProxy] rendered', data.data);
				if (this.onQueued) {
					this.onQueued(data.data);
				}
				break;
			case 'status':
				// console.log('[PlayerProxy] status', data.data);
				if (this.onStatus) {
					this.onStatus(data.data);
				}
				break;
			case 'reset':
				if (this.onReset) {
					this.onReset();
				}
				break;
			case 'user-event':
				this.handleUserEvent(data.data);
				break;
			case 'user-marker-resp':
				if (this.onUserMarker) {
					this.onUserMarker(data.data);
				}
				break;
			default:
				if (typeof data.id === 'number') {
					for (let i = 0, len = this.defers.length; i < len; ++i) {
						const def = this.defers[i];
						if (def.id === data.id && def.type === data.type) {
							this.defers.splice(i, 1);
							def.resolve(data.data);
							break;
						}
					}
				}
				break;
		}
	}

	private doStop() {
		if (!this.stopResolver) {
			return;
		}
		this.userEventData = {};
		this.userEventId = 0;
		this.stopResolver();
		this.stopResolver = null;
		if (this.onStop) {
			this.onStop();
		}
	}

	private handleUserEvent(data: string) {
		const d = this.userEventData[data];
		if (!d) {
			return;
		}
		delete this.userEventData[data];
		if (this.onUserData) {
			this.onUserData(d.data);
		}
	}
}
