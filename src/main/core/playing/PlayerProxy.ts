import * as JSSynth from 'js-synthesizer';

import * as Message from '../../types/MessageData';
import * as RenderMessage from '../../types/RenderMessageData';
import * as Response from '../../types/ResponseData';

import createAudioWorkletNode from './createAudioWorkletNode';
import createPortWithStream from './createPortWithStream';
import createScriptProcessorNode from './createScriptProcessorNode';
import Options from './Options';

import IPlayStream from '../IPlayStream';

type ResponseDataTypeBase<
	TType extends Response.AllTypes['type'],
	TResponseType extends Response.AllTypes
> = TResponseType extends { type: TType } ? TResponseType['data'] : never;
type ResponseDataType<
	TType extends Response.AllTypes['type']
> = ResponseDataTypeBase<TType, Response.AllTypes>;

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
	private defers: Array<{
		id: number;
		type: Response.AllTypes['type'];
		resolve: (data?: any) => void;
	}>;
	private userEventData: {
		[key: string]: { data: any };
	} = {};
	private userEventId: number = 0;

	private constructor(
		private port: MessagePort,
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
			interval: interval,
			sampleRate: sampleRate,
			channelCount: channelCount,
		};
		const ret = proxy.addDefer(0, 'initialize').then(() => proxy);
		worker.postMessage(initData, [channel.port2]);
		return ret;
	}

	public close() {
		const data: Message.Close = {
			type: 'close',
		};
		this.port.postMessage(data);
		this.port.close();
	}

	public loadSoundfont(bin: ArrayBuffer, transfer?: boolean) {
		const data: Message.LoadSoundfont = {
			id: this.msgId++,
			type: 'load-sfont',
			data: bin,
		};
		const ret = this.addDefer(data.id, 'load-sfont');
		this.port.postMessage(data, transfer ? [bin] : []);
		return ret;
	}

	public unloadSoundfont(sfontId: number) {
		const data: Message.UnloadSoundfont = {
			id: this.msgId++,
			type: 'unload-sfont',
			sfontId: sfontId,
		};
		const ret: Promise<void> = this.addDefer(data.id, 'unload-sfont');
		this.port.postMessage(data);
		return ret;
	}

	public configure(config: Message.ConfigBase) {
		if (typeof config.framesCount === 'number') {
			this.framesCount = config.framesCount;
		}

		const data: Message.Configure = {
			...config,
			id: this.msgId++,
			type: 'config',
		};
		const ret: Promise<void> = this.addDefer(data.id, 'config');
		this.port.postMessage(data);
		return ret;
	}

	public startWithScriptProcessorNode(
		ctx: BaseAudioContext,
		options: Options
	) {
		const r = createScriptProcessorNode(ctx, this.framesCount, options);
		this.startImpl(r.port);
		return r.node;
	}

	public startWithAudioWorkletNode(ctx: BaseAudioContext, options: Options) {
		const r = createAudioWorkletNode(ctx, options);
		this.startImpl(r.port);
		return r.node;
	}

	public startForStream(stream: IPlayStream, options: Options) {
		const port = createPortWithStream(stream, this.sampleRate, options);
		this.startImpl(port);
	}

	public startWithExistingConnection() {
		const data: Message.Start = {
			type: 'start',
			playingId: this.initPlayingId(),
		};
		this.port.postMessage(data);
		this.stopPromise = new Promise((resolve) => {
			this.stopResolver = resolve;
		});
	}

	private startImpl(renderPort: MessagePort) {
		const data: Message.Start = {
			type: 'start',
			playingId: this.initPlayingId(),
			renderPort: renderPort,
		};
		this.port.postMessage(data, [renderPort]);
		this.stopPromise = new Promise((resolve) => {
			this.stopResolver = resolve;
		});
	}

	public pause(isPaused: boolean) {
		const data: Message.Pause = {
			id: this.msgId++,
			type: 'pause',
			paused: isPaused,
		};
		const ret = this.addDefer(data.id, 'pause');
		this.port.postMessage(data);
		return ret;
	}

	public stop() {
		this.port.postMessage({ type: 'stop' } as Message.Stop);
	}

	public resetTime() {
		this.port.postMessage({ type: 'reset-time' } as Message.ResetTime);
	}

	public releasePlayer(resetSynth?: boolean) {
		this.port.postMessage({
			type: 'release',
			resetSynth: resetSynth,
		} as Message.Release);
	}

	public waitForFinish(timeoutMilliseconds?: number) {
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

	public sendEvent(eventData: JSSynth.SequencerEvent, time: number) {
		const data: Message.Event = {
			type: 'event',
			time: time,
			data: eventData,
		};
		this.port.postMessage(data);
	}

	public sendEventNow(eventData: JSSynth.SequencerEvent) {
		const data: Message.Event = {
			type: 'event',
			time: null,
			data: eventData,
		};
		this.port.postMessage(data);
	}

	public sendEvents(events: Array<[JSSynth.SequencerEvent, number | null]>) {
		const data: Message.Events = {
			type: 'events',
			data: events,
		};
		this.port.postMessage(data);
	}

	public sendSysEx(bin: Uint8Array, time: number) {
		const data: Message.SysEx = {
			type: 'sysex',
			time: time,
			data: bin.slice(0).buffer,
		};
		this.port.postMessage(data, [data.data]);
	}

	public sendSysExNow(bin: Uint8Array) {
		const data: Message.SysEx = {
			type: 'sysex',
			time: null,
			data: bin.slice(0).buffer,
		};
		this.port.postMessage(data, [data.data]);
	}

	public sendGeneratorValue(
		channel: number,
		type: JSSynth.Constants.GeneratorTypes,
		value: number | null,
		keepCurrentVoice: boolean | null | undefined,
		time: number
	) {
		const data: Message.Generator = {
			type: 'gen',
			time: time,
			data: {
				channel,
				type,
				value,
				keepCurrentVoice,
			},
		};
		this.port.postMessage(data);
	}

	public sendGeneratorValueNow(
		channel: number,
		type: JSSynth.Constants.GeneratorTypes,
		value: number | null,
		keepCurrentVoice: boolean | null | undefined
	) {
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
		this.port.postMessage(data);
	}

	public sendUserData(userData: any, time: number) {
		const id = this.userEventId++;
		const text = `ud-${id}`;
		this.userEventData[text] = { data: userData };
		const data: Message.UserEvent = {
			type: 'user-event',
			time: time,
			data: text,
		};
		this.port.postMessage(data);
	}

	public sendFinishMarker(time: number) {
		const data: Message.FinishMarker = {
			type: 'finish',
			time: time,
		};
		this.port.postMessage(data);
	}

	public sendFinishMarkerNow() {
		const data: Message.FinishMarker = {
			type: 'finish',
			time: null,
		};
		this.port.postMessage(data);
	}

	public sendUserMarker(time: number, marker: string) {
		const data: Message.UserMarker = {
			type: 'user-marker',
			time: time,
			marker: marker,
		};
		this.port.postMessage(data);
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
				id: id,
				type: type,
				resolve: resolve,
			});
		});
	}

	private onMessage(e: MessageEvent) {
		const data: Response.AllTypes = e.data;
		if (!data) {
			return;
		}
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
