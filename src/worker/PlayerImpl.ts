import type ISequencer from 'js-synthesizer/ISequencer';
import type ISequencerEventData from 'js-synthesizer/ISequencerEventData';
import type SequencerEvent from 'js-synthesizer/SequencerEvent';
import {
	type ControlChangeEvent,
	type NoteEvent,
	type NoteOnEvent,
	type NoteOffEvent,
	EventType as SequencerEventTypes,
} from 'js-synthesizer/SequencerEvent';
import type Synthesizer from 'js-synthesizer/Synthesizer';
import type SynthesizerSettings from 'js-synthesizer/SynthesizerSettings';
import type ITimer from './types/ITimer';
import type * as Message from './types/MessageData';
import type * as RenderMessage from './types/RenderMessageData';
import type * as Response from './types/ResponseData';

const enum Defaults {
	SampleRate = 48000,
	FramesCount = 8192,
	Interval = 40,
	Gain = 1,
}

type GenEvent = Message.Generator['data'];

// eslint-disable-next-line no-var
declare var JSSynth: typeof import('js-synthesizer');

// Written necessary only
export type LibfluidsynthModule = {
	[name: string]: (...args: any[]) => any;
	_malloc: (size: number) => number;
	_free: (ptr: number) => void;
} & {
	HEAPU32: Uint32Array;
};

// eslint-disable-next-line no-var
declare var Module: LibfluidsynthModule;

let _jssynth: typeof import('js-synthesizer');
let _module: LibfluidsynthModule;

async function waitForWasmInitialized(
	_JSSynth?: typeof _jssynth,
	module?: LibfluidsynthModule
) {
	if (_JSSynth && module) {
		_jssynth = _JSSynth;
		_jssynth.Synthesizer.initializeWithFluidSynthModule(module);
		await _jssynth.Synthesizer.waitForWasmInitialized();
		_module = module;
	} else {
		_jssynth = JSSynth;
		await _jssynth.Synthesizer.waitForWasmInitialized();
		_module = Module;
	}
}

function promiseWithTimeout<T>(
	timer: ITimer,
	promise: Promise<T>,
	timeoutMilliseconds: number
) {
	return new Promise<T>((resolve, reject) => {
		let resolved = false;
		const id = timer.set(() => {
			if (!resolved) {
				resolved = true;
				reject(new Error('timeout'));
			}
		}, timeoutMilliseconds);
		promise.then(
			(r) => {
				if (!resolved) {
					timer.clear(id);
					resolved = true;
					resolve(r);
				}
			},
			(e) => {
				if (!resolved) {
					timer.clear(id);
					resolved = true;
					reject(e);
				}
			}
		);
	});
}

function isControlChange(e: SequencerEvent): e is ControlChangeEvent {
	return (
		e.type === SequencerEventTypes.ControlChange ||
		e.type === 'controlchange' ||
		e.type === 'control-change'
	);
}

function isNoteEvent(
	e: SequencerEvent
): e is NoteEvent | NoteOnEvent | NoteOffEvent {
	return (
		e.type === SequencerEventTypes.Note ||
		e.type === 'note' ||
		e.type === SequencerEventTypes.NoteOn ||
		e.type === 'noteon' ||
		e.type === 'note-on' ||
		e.type === SequencerEventTypes.NoteOff ||
		e.type === 'noteoff' ||
		e.type === 'note-off'
	);
}

/**
 * This function drops 'duplicated' events (excluding note events), to avoid undefined order of events on FluidSynth
 * (refs. https://www.fluidsynth.org/api/group__sequencer.html#ga83314f4ad773979841afe50cc2efd83f)
 */
function dropDuplicatedEvents(
	q: Array<{
		client: number;
		data: SequencerEvent;
		tick: number;
	}>
): boolean {
	let lastTick = -1;
	let lastIndex = -1;
	let tickChanged = false;
	for (let i = 0; i < q.length; ) {
		let removed = false;
		const o = q[i];
		if (o.tick !== lastTick) {
			lastIndex = -1;
			lastTick = o.tick;
		}
		if ('channel' in o.data && !isNoteEvent(o.data)) {
			if (lastIndex < 0) {
				lastIndex = i;
			} else {
				for (let j = lastIndex; j < i; ++j) {
					const x = q[j];
					if (
						x.data.type === o.data.type &&
						'channel' in x.data &&
						x.data.channel === o.data.channel
					) {
						let drop = true;
						if (
							isControlChange(x.data) &&
							isControlChange(o.data)
						) {
							if (x.data.control === o.data.control) {
								// check if the control is 'Switch' (e.g. Hold)
								if (
									x.data.control >= 64 &&
									x.data.control < 96 &&
									x.data.value >= 64 !== o.data.value >= 64 &&
									// if tick > 0, this control would be meaningful
									x.tick > 0
								) {
									// adjust tick '-1' to avoid 'undefined' order of FluidSynth
									--x.tick;
									tickChanged = true;
									drop = false;
								}
							} else {
								continue;
							}
						}
						if (drop) {
							console.log(
								'[dropDuplicatedEvents] remove event:',
								x.data
							);
							q.splice(j, 1);
							removed = true;
						}
						break;
					}
				}
			}
		}
		if (!removed) {
			++i;
		}
	}
	return tickChanged;
}

export interface RenderTarget {
	onMessage: (
		data: RenderMessage.AllTypes,
		transferable?: Transferable[]
	) => void;
	addMessageListener: (
		listener: (data: RenderMessage.AllTypes) => void
	) => () => void;
	close?: () => void;
}

export default class PlayerImpl<TTimerId = unknown> {
	private readonly port: MessagePort;
	private renderTarget: RenderTarget | undefined;
	private readonly renderTargetBase: RenderTarget | undefined;
	private isExternalRenderTarget: boolean;
	private unregisterHandler: (() => void) | undefined;
	private synth!: Synthesizer;
	private sequencer: ISequencer | undefined;
	private myClient!: number;
	/** timer id for onRender method; also used for check 'playing' (non-null indicates 'playing') */
	private timerId: ReturnType<ITimer<TTimerId>['set']> | null = null;
	private readonly onTimerBind: () => void;
	private playingId: number | undefined;
	private renderQuantumSize: number | null = null;
	private starting: boolean;
	private pauseRender: boolean;
	private startTime: number;
	private hasFinished: boolean;
	private promiseWaitingForStop: Promise<void> | undefined;
	private allRendered: boolean;
	private finishTimer: ReturnType<ITimer<TTimerId>['set']> | null = null;
	private stopTimerOnFinish: ReturnType<ITimer<TTimerId>['set']> | null =
		null;
	private promiseResetTime: Promise<void> | undefined;

	private readonly midiChannelCount: number;
	private readonly sampleRate: number;
	private timerInterval: number;
	private framesCount: number;
	private gain: number;
	private channel16IsDrums: boolean;

	private channelGenData: {
		[channel: number]:
			| {
					[type: number]:
						| {
								init: number;
								prev: number;
						  }
						| undefined;
			  }
			| undefined;
	} = {};

	private eventQueue: Array<{
		client: number;
		data: SequencerEvent;
		tick: number;
	}> = [];
	private sorted: boolean = true;
	private queuedFrames: number = 0;
	private queuedTime: number = 0;

	private userMsgMap: {
		[id: number]:
			| {
					sysEx?: Uint8Array;
					genEvent?: GenEvent;
					userEvent?: string;
					userMarker?: string;
			  }
			| undefined;
	} = {};
	private userMsgMapId: number = 0;

	private readonly timer: ITimer<TTimerId>;
	private renderEnabled: boolean = false;
	private readonly manualRender: boolean;
	private readonly onRenderMessageBind: PlayerImpl['onRenderMessage'];

	constructor(
		timer: ITimer<TTimerId>,
		data: Message.Initialize,
		manualRender?: boolean,
		renderTarget?: RenderTarget
	);
	constructor(
		timer: ITimer<TTimerId>,
		data: Message.Initialize,
		manualRender: boolean,
		renderTarget: RenderTarget,
		JSSynth: typeof _jssynth,
		module: LibfluidsynthModule
	);

	constructor(
		timer: ITimer<TTimerId>,
		data: Message.Initialize,
		manualRender?: boolean,
		renderTarget?: RenderTarget,
		JSSynth?: typeof _jssynth,
		module?: LibfluidsynthModule
	) {
		this.timer = timer;
		this.manualRender = manualRender === true;
		this.port = data.port;
		this.starting = false;
		this.pauseRender = false;
		this.startTime = 0;
		this.hasFinished = false;
		this.allRendered = false;

		// uses the default value if zero
		this.sampleRate = data.sampleRate || Defaults.SampleRate;
		// uses the default value if zero
		this.midiChannelCount =
			Math.ceil(((data.channelCount || 16) + 15) / 16) * 16;
		this.timerInterval = Defaults.Interval;
		this.framesCount = Defaults.FramesCount;
		this.gain = Defaults.Gain;
		this.channel16IsDrums = false;

		this.onTimerBind = this.onTimer.bind(this);
		this.onRenderMessageBind = this.onRenderMessage.bind(this);
		this.renderTarget = this.renderTargetBase = renderTarget;
		this.isExternalRenderTarget = renderTarget != null;

		this.doInitialize(data, JSSynth, module).catch((e) => {
			if (typeof console !== 'undefined') {
				console.error(e);
			}
			throw e;
		});
	}

	public render(preferredFrameSize?: number | null): void {
		this.onRender(preferredFrameSize);
	}

	private doInitSynth() {
		const obj: SynthesizerSettings = {
			midiChannelCount: this.midiChannelCount,
		};
		this.synth.init(this.sampleRate, obj);
		this.synth.setGain(this.gain);

		// console.log('  synthesizer initialized.');
		this.postReset();
	}

	private async doInitialize(
		data: Message.Initialize,
		JSSynth?: typeof _jssynth,
		module?: LibfluidsynthModule
	) {
		// console.log('[PlayerImpl] Wait for wasm initialized...');
		await waitForWasmInitialized(JSSynth, module);
		// console.log('[PlayerImpl]   ok.');

		this.port.addEventListener('message', this.onMessage.bind(this));
		this.port.start();

		this.synth = new _jssynth.Synthesizer();
		this.doInitSynth();

		this.doConfigure(data);

		this.postDefaultResponse(data.id, 'initialize');
		// console.log('[PlayerImpl] Initialize done.');
	}

	private doConfigure(data: Message.ConfigBase) {
		if (typeof data.interval !== 'undefined') {
			this.timerInterval = data.interval;
			if (this.renderEnabled) {
				this.doStartTimer();
			}
		}
		if (typeof data.framesCount !== 'undefined') {
			this.framesCount = data.framesCount;
		}
		if (typeof data.gain !== 'undefined') {
			this.gain = data.gain;
			this.synth.setGain(this.gain);
		}
		if (typeof data.channel16IsDrums !== 'undefined') {
			this.channel16IsDrums = data.channel16IsDrums;
			this.synth.setChannelType(15, this.channel16IsDrums);
		}
	}

	private doStartTimer() {
		this.doStopTimer();
		this.renderEnabled = true;
		if (this.manualRender) {
			return;
		}
		this.timerId = this.timer.set(this.onTimerBind, this.timerInterval);
	}

	private doStopTimer() {
		this.renderEnabled = false;
		if (this.timerId !== null) {
			this.timer.clear(this.timerId);
			this.timerId = null;
		}
	}

	private doSendEvents(preferredFrameSize?: number | null) {
		const processStartTime = Date.now();
		const timeout =
			preferredFrameSize != null
				? Math.floor((preferredFrameSize * 1000) / this.sampleRate)
				: null;
		const q = this.eventQueue;
		if (!this.sorted) {
			q.sort((a, b) => a.tick - b.tick);
			if (dropDuplicatedEvents(q)) {
				q.sort((a, b) => a.tick - b.tick);
			}
			this.sorted = true;
		}
		const toTime = (this.queuedTime + 5) * 1000 + this.startTime;
		// if (q.length > 0) {
		// 	console.log(
		// 		`[doSendEvents] q.length = ${q.length}, toTime = ${toTime}, pauseRender = ${this.pauseRender}`
		// 	);
		// }
		while (q.length) {
			const e = q[0];
			if (e.tick >= toTime) {
				break;
			}
			q.shift();
			// if (e.data.type === SequencerEventTypes.Timer) {
			// 	console.log(`[doSendEvents] sending timer event`);
			// }
			// console.log(`[doSendEvents] e.data.type = ${e.data.type}, e.tick(diff) = ${e.tick - this.startTime}`);
			this.sequencer!.sendEventToClientAt(e.client, e.data, e.tick, true);
			if (timeout != null) {
				const n = Date.now() - processStartTime;
				if (n >= timeout) {
					// console.log(
					// 	`[doSendEvents] process interrupted for timeout = ${timeout}ms (took ${n}ms, q.length = ${q.length})`
					// );
					break;
				}
			}
		}
	}

	private async waitForVoicesStopped() {
		if (!this.synth.isPlaying()) {
			return;
		}
		const p =
			this.promiseWaitingForStop ||
			(this.promiseWaitingForStop = (async () => {
				// console.log('Waiting for voices stopped...');
				try {
					await promiseWithTimeout(
						this.timer,
						this.synth.waitForVoicesStopped(),
						5000
					);
				} catch (_e) {
					// voice will not stopped, so re-initialize to reset
					const c = typeof console !== 'undefined' ? console : void 0;
					if (c) {
						// const syn = this.synth.getRawSynthesizer();
						c.warn(
							'[js-sequencer] player did not stop in 5 seconds; reset synthesizer...'
							// _module._fluid_synth_get_active_voice_count(syn)
						);
					}
					this.resetSynth();
				}
				// console.log('  done. (waitForVoicesStopped)');
				this.promiseWaitingForStop = void 0;
			})());
		await p;
	}

	private resetSynth() {
		this.doStopTimer();
		if (this.renderTarget) {
			const t = this.renderTarget;
			const msg: RenderMessage.Release = {
				type: 'release',
			};
			t.onMessage(msg);
			if (t.close) {
				t.close();
			}
			const unreg = this.unregisterHandler;
			if (unreg) {
				unreg();
				this.unregisterHandler = void 0;
			}
			if (!this.isExternalRenderTarget) {
				this.renderTarget = this.renderTargetBase;
				this.isExternalRenderTarget = this.renderTargetBase != null;
			}
		}
		if (this.sequencer) {
			// console.log('Unregistereing clients from sequencer and close sequencer...');
			this.sequencer.close();
			this.sequencer = void 0;
		}
		this.doInitSynth();
	}

	private postMessage(data: Response.AllTypes, transfer?: Transferable[]) {
		this.port.postMessage(data, transfer || []);
	}

	private postDefaultResponse(
		id: number,
		messageType: Response.NoResponseMessageTypes
	) {
		this.postMessage({ id, type: messageType });
	}

	private postReset() {
		this.postMessage({ type: 'reset' });
	}

	private postStop() {
		this.postMessage({ type: 'stop', data: this.playingId! });
	}

	private sendUserMarkerImpl(marker: string) {
		if (this.renderTarget) {
			const sendData: RenderMessage.UserMarkerSend = {
				type: 'user-marker-send',
				data: marker,
			};
			this.renderTarget.onMessage(sendData);
		}
	}

	private onSequencerCallback(
		_time: number,
		eventType: SequencerEventTypes,
		event: ISequencerEventData,
		_sequencer: ISequencer,
		_param: number
	) {
		if (eventType === SequencerEventTypes.Timer) {
			const id = event.getData();
			if (id === -1) {
				// console.log(`[onSequencerCallback] finished marker reached`);
				this.prepareForStopForFinish();
			} else {
				const data = this.userMsgMap[id];
				if (data) {
					delete this.userMsgMap[id];
					if (data.sysEx) {
						this.synth.midiSysEx(data.sysEx);
					} else if (data.genEvent) {
						this.onProcessGenEvent(data.genEvent);
					} else if ('userEvent' in data) {
						this.postMessage({
							type: 'user-event',
							data: data.userEvent!,
						});
					} else if ('userMarker' in data) {
						this.sendUserMarkerImpl(data.userMarker!);
					}
				}
			}
		}
	}

	private onProcessGenEvent({
		channel,
		type,
		value,
		keepCurrentVoice,
	}: GenEvent) {
		const data = this.channelGenData;
		const chData = data[channel] || (data[channel] = {});
		const o =
			chData[type] ||
			(chData[type] = {
				init: this.synth.getGenerator(channel, type),
				prev: 0,
			});
		const newVal = value === null ? o.init : value;

		// setGenerator affects to the current voices.
		// To keep generator values for the current voices,
		// add generator values with 'diff' to each voices before
		// calling setGenerator.
		if (keepCurrentVoice) {
			const diff = newVal - o.prev;
			const syn = this.synth.getRawSynthesizer();
			// prot: int fluid_synth_get_active_voice_count(fluid_synth_t*)
			const voiceCount: number =
				_module._fluid_synth_get_active_voice_count(syn) as number;
			// fluid_voice_t* voiceList = malloc(sizeof(fluid_voice_t*) * voiceCount)
			const voiceList: number = _module._malloc(voiceCount * 4);
			// prot: void fluid_synth_get_voicelist(fluid_synth_t*, fluid_voice_t*, int, int)
			_module._fluid_synth_get_voicelist(syn, voiceList, voiceCount, -1);
			for (let i = 0; i < voiceCount; ++i) {
				// auto voice = voiceList[i]
				const voice = _module.HEAPU32[(voiceList >> 2) + i];
				// prot: int fluid_voice_gen_incr(fluid_voice_t*, int, int)
				_module._fluid_voice_gen_incr(voice, type, -diff);
			}
			_module._free(voiceList);
		}
		this.synth.setGenerator(channel, type, newVal);

		o.prev = newVal;
	}

	private prepareForStopForFinish() {
		this.hasFinished = true;
		this.synth.midiAllSoundsOff();
		this.timer.set(() => {
			// send user-marker 'stop' to render process to detect that the render process has finished
			// console.log(
			// 	'[PlayerImpl] prepareForStopForFinish: send stop marker'
			// );
			this.sendUserMarkerImpl('stop');
		}, 0);
	}

	/** Handle when received 'stop' user-marker */
	private onStopForFinish(delay: number) {
		this.stopTimerOnFinish = this.timer.set(() => {
			this.stopTimerOnFinish = null;
			if (this.finishTimer !== null) {
				this.timer.clear(this.finishTimer);
			}
			if (!this.allRendered) {
				this.allRendered = true;
			}
			void this.onStop();
		}, delay);
	}

	/** Timeout callback for waiting 'stop' user-marker */
	private onStopForFinishTimeout() {
		this.finishTimer = null;
		if (this.stopTimerOnFinish !== null) {
			this.timer.clear(this.stopTimerOnFinish);
			this.stopTimerOnFinish = null;
		}
		if (!this.allRendered) {
			this.allRendered = true;
		}
		void this.onStop();
	}

	private onTimer() {
		if (this.allRendered) {
			return;
		}
		this.onRender();
		this.timerId = this.timer.set(this.onTimerBind, this.timerInterval);
	}

	private onRender(preferredFrameSize?: number | null) {
		if (!this.renderEnabled) {
			return;
		}
		if (this.allRendered) {
			return;
		}

		this.doSendEvents(preferredFrameSize);

		if (this.pauseRender) {
			return;
		}

		const size =
			preferredFrameSize != null ? preferredFrameSize : this.framesCount;
		const buffers: [ArrayBuffer, ArrayBuffer] = [
			new ArrayBuffer(size * 4),
			new ArrayBuffer(size * 4),
		];
		// console.log(`[PlayerImpl] onRender framesCount = ${size}`);
		this.synth.render(buffers.map((buffer) => new Float32Array(buffer)));

		const renderFrames: Array<[ArrayBuffer, ArrayBuffer]> = [];
		let transferable: Transferable[];
		if (this.renderQuantumSize != null) {
			transferable = [];
			const baseL = new Float32Array(buffers[0]);
			const baseR = new Float32Array(buffers[1]);
			for (let f = 0; f < size; f += this.renderQuantumSize) {
				const s = Math.min(size - f, this.renderQuantumSize);
				const lb = new ArrayBuffer(s * 4);
				const rb = new ArrayBuffer(s * 4);
				const l = new Float32Array(lb);
				const r = new Float32Array(rb);
				l.set(baseL.subarray(f, f + s));
				r.set(baseR.subarray(f, f + s));
				renderFrames.push([lb, rb]);
				transferable.push(lb);
				transferable.push(rb);
			}
		} else {
			renderFrames.push(buffers);
			transferable = buffers;
		}

		const data: RenderMessage.Render = {
			type: 'render',
			data: renderFrames,
		};
		this.renderTarget!.onMessage(data, transferable);

		if (!this.synth.isPlaying() && this.hasFinished) {
			// console.log('[PlayerImpl] onRender: allRendered');
			this.allRendered = true;
		}
	}

	private onMessage(e: MessageEvent) {
		// console.log(
		// 	`[PlayerImpl][onMessage] promiseResetTime != null = ${this.promiseResetTime != null}`
		// );
		void this.onMessageImpl(e);
	}

	private async onMessageImpl(e: MessageEvent) {
		await this.promiseResetTime;

		const data = e.data as unknown as Message.AllTypes | null | undefined;
		if (!data) {
			return;
		}
		// console.log(
		// 	`[onMessageImpl] type = ${data.type}, time = ${'time' in data ? data.time : '(nothing)'}`
		// );
		switch (data.type) {
			case 'close':
				this.onClose();
				break;
			case 'config':
				this.onConfigure(data);
				break;
			case 'load-sfont':
				await this.onLoadSoundfont(data);
				break;
			case 'unload-sfont':
				this.onUnloadSoundfont(data);
				break;
			case 'start':
				await this.onStart(data);
				break;
			case 'pause':
				this.onPause(data);
				break;
			case 'stop':
				await this.onStop();
				break;
			case 'release':
				await this.onRelease(data);
				break;
			case 'event':
				this.onEvent(data);
				break;
			case 'events':
				this.onEvents(data);
				break;
			case 'sysex':
				this.onSysEx(data);
				break;
			case 'gen':
				this.onGen(data);
				break;
			case 'user-event':
				this.onUserEvent(data);
				break;
			case 'finish':
				this.onFinishMarker(data);
				break;
			case 'user-marker':
				this.onUserMarker(data);
				break;
			case 'reset-time':
				this.promiseResetTime = this.onResetTime(data);
				// ignore unhandled promise rejection here
				// eslint-disable-next-line @typescript-eslint/no-empty-function
				this.promiseResetTime.catch(() => {});
				break;
		}
	}

	private onClose() {
		this.doStopTimer();
		if (this.renderTarget) {
			const t = this.renderTarget;
			const msg: RenderMessage.Release = {
				type: 'release',
			};
			t.onMessage(msg);
			const unreg = this.unregisterHandler;
			if (unreg) {
				unreg();
				this.unregisterHandler = void 0;
			}
			if (t.close) {
				t.close();
			}
			if (!this.isExternalRenderTarget) {
				this.renderTarget = this.renderTargetBase;
				this.isExternalRenderTarget = this.renderTargetBase != null;
			}
		}
		if (this.sequencer) {
			this.sequencer.close();
			this.sequencer = void 0;
		}
		this.synth.close();
		this.port.close();
	}

	private onConfigure(data: Message.Configure) {
		this.doConfigure(data);
		this.postDefaultResponse(data.id, 'config');
	}

	private async onLoadSoundfont(data: Message.LoadSoundfont) {
		const sfontId = await this.synth.loadSFont(data.data);
		this.postMessage({
			id: data.id,
			type: 'load-sfont',
			data: sfontId,
		});
	}

	private onUnloadSoundfont(data: Message.UnloadSoundfont) {
		this.synth.unloadSFont(data.sfontId);
		this.postDefaultResponse(data.id, 'unload-sfont');
	}

	private async onStart(data: Message.Start) {
		this.playingId = data.playingId;
		if (!data.renderPort && !this.renderTarget) {
			// console.log('Sending \'stop\' from onStart:', !!data.renderPort, !!this.renderPort);
			this.postStop();
			return;
		}
		if (this.starting) {
			// console.log('onStart ignored because already waiting.');
			return;
		}
		if (data.renderQuantumSize != null) {
			this.renderQuantumSize = data.renderQuantumSize;
		}
		this.starting = true;
		await this.waitForVoicesStopped();
		if (!this.starting) {
			// console.log('Start canceled.');
			return;
		}
		this.starting = false;

		if (!this.sequencer) {
			// console.log('Wait for create sequencer...');
			const seq = await _jssynth.Synthesizer.createSequencer();
			// console.log('  ok.');
			this.sequencer = seq;
			await seq.registerSynthesizer(this.synth);
			this.myClient = _jssynth.Synthesizer.registerSequencerClient(
				seq,
				'js-sequencer',
				this.onSequencerCallback.bind(this),
				0
			);
		}

		const tick = await this.sequencer.getTick();
		// console.log('[PlayerImpl] onStart tick:', tick);
		this.pauseRender = false;
		this.hasFinished = false;
		this.allRendered = false;
		this.eventQueue = [];
		this.sorted = true;
		this.queuedFrames = 0;
		this.queuedTime = 0;
		this.userMsgMap = {};
		this.userMsgMapId = 0;
		this.startTime = tick;
		if (data.renderPort) {
			const port = data.renderPort;
			this.renderTarget = {
				addMessageListener: (listener) => {
					const fn = (
						e: MessageEvent<
							RenderMessage.AllTypes | null | undefined
						>
					) => {
						if (!e.data) {
							return;
						}
						listener(e.data);
					};
					port.addEventListener('message', fn);
					return () => {
						port.removeEventListener('message', fn);
					};
				},
				onMessage: (data, transferable) => {
					port.postMessage(data, transferable || []);
				},
				close: () => {
					port.close();
				},
			};
			this.isExternalRenderTarget = false;
			port.start();
		}
		if (this.unregisterHandler == null) {
			this.unregisterHandler = this.renderTarget!.addMessageListener(
				this.onRenderMessageBind
			);
		}
		this.channelGenData = {};

		this.synth.midiSystemReset();
		this.synth.setChannelType(15, this.channel16IsDrums);
		for (let i = 0; i < 16; ++i) {
			const isDrum = i === 9 || (this.channel16IsDrums && i === 15);
			this.synth.midiProgramSelect(
				i,
				data.sfontDefault,
				isDrum ? 128 : 0,
				0
			);
		}

		this.doStartTimer();
	}

	private onPause(data: Message.Pause) {
		if (!this.renderTarget) {
			this.postMessage({
				type: data.type,
				id: data.id,
				data: false,
			});
		} else {
			const msg: RenderMessage.Pause = {
				type: 'pause',
				data: {
					id: data.id,
					paused: data.paused,
				},
			};
			this.renderTarget.onMessage(msg);
		}
	}

	private async onStop() {
		const isWaitingFinish = this.hasFinished;
		// console.log('[PlayerImpl] onStop():', isWaitingFinish);
		if (this.stopTimerOnFinish !== null) {
			this.timer.clear(this.stopTimerOnFinish);
			this.stopTimerOnFinish = null;
		}
		if (this.finishTimer !== null) {
			this.timer.clear(this.finishTimer);
			this.finishTimer = null;
		}
		this.starting = false;
		if (this.sequencer && this.renderEnabled) {
			this.doStopTimer();
			const msgStop: RenderMessage.Stop = {
				type: 'stop',
			};
			this.renderTarget!.onMessage(msgStop);
			if (this.synth.isPlaying()) {
				this.sequencer.removeAllEvents();
				this.sequencer.sendEventAt(
					{
						type: 'system-reset',
					},
					0,
					false
				);
				await this.waitForVoicesStopped();
				// console.log('Sending \'stop\'');
				this.postStop();
			} else if (isWaitingFinish) {
				// In this case 'this.synth' is not playing but playing process is still active.
				// console.log('Sending \'stop\' because not playing');
				this.postStop();
			}
			// console.log('  Done.');
		}
	}

	private async onRelease(data: Message.Release) {
		// console.log('[PlayerImpl] onRelease()');
		this.starting = false;
		if (this.sequencer) {
			if (this.renderEnabled) {
				await this.onStop();
			}
			if (this.renderTarget) {
				const t = this.renderTarget;
				const msg: RenderMessage.Release = {
					type: 'release',
				};
				t.onMessage(msg);
				if (t.close) {
					t.close();
				}
				const unreg = this.unregisterHandler;
				if (unreg) {
					unreg();
					this.unregisterHandler = void 0;
				}
				if (!this.isExternalRenderTarget) {
					this.renderTarget = this.renderTargetBase;
					this.isExternalRenderTarget = this.renderTargetBase != null;
				}
			}
			// console.log('Unregistereing clients from sequencer and close sequencer...');
			this.sequencer.close();
			this.sequencer = void 0;
			// console.log('  Done.');
		}
		if (data.resetSynth) {
			this.doInitSynth();
		}
	}

	private onEvent(data: Message.Event) {
		if (!this.sequencer) {
			return;
		}
		if (data.time === null) {
			this.sequencer.sendEventToClientAt(-1, data.data, 0, false);
		} else {
			const tick = this.startTime + data.time;
			this.eventQueue.push({
				client: -1,
				data: data.data,
				tick,
			});
			this.sorted = false;
		}
	}

	private onEvents(data: Message.Events) {
		if (!this.sequencer) {
			return;
		}
		for (const [e, time] of data.data) {
			if (time === null) {
				this.sequencer.sendEventToClientAt(-1, e, 0, false);
			} else {
				const tick = this.startTime + time;
				this.eventQueue.push({
					client: -1,
					data: e,
					tick,
				});
				this.sorted = false;
			}
		}
	}

	private onSysEx(data: Message.SysEx) {
		if (!this.sequencer) {
			return;
		}
		const bin = new Uint8Array(data.data);
		const id = this.userMsgMapId++;
		this.userMsgMap[id] = { sysEx: bin };

		if (data.time === null) {
			this.sequencer.sendEventToClientAt(
				this.myClient,
				{
					type: SequencerEventTypes.Timer,
					data: id,
				},
				0,
				false
			);
		} else {
			const tick = this.startTime + data.time;
			this.eventQueue.push({
				client: this.myClient,
				data: {
					type: SequencerEventTypes.Timer,
					data: id,
				},
				tick,
			});
			this.sorted = false;
		}
	}

	private onGen(data: Message.Generator) {
		if (!this.sequencer) {
			return;
		}
		const id = this.userMsgMapId++;
		this.userMsgMap[id] = {
			genEvent: data.data,
		};

		if (data.time === null) {
			this.sequencer.sendEventToClientAt(
				this.myClient,
				{
					type: SequencerEventTypes.Timer,
					data: id,
				},
				0,
				false
			);
		} else {
			const tick = this.startTime + data.time;
			this.eventQueue.push({
				client: this.myClient,
				data: {
					type: SequencerEventTypes.Timer,
					data: id,
				},
				tick,
			});
			this.sorted = false;
		}
	}

	private onUserEvent(data: Message.UserEvent) {
		if (!this.sequencer) {
			return;
		}
		const id = this.userMsgMapId++;
		this.userMsgMap[id] = { userEvent: data.data };

		if (data.time === null) {
			this.sequencer.sendEventToClientAt(
				this.myClient,
				{
					type: SequencerEventTypes.Timer,
					data: id,
				},
				0,
				false
			);
		} else {
			const tick = this.startTime + data.time;
			this.eventQueue.push({
				client: this.myClient,
				data: {
					type: SequencerEventTypes.Timer,
					data: id,
				},
				tick,
			});
			this.sorted = false;
		}
	}

	private onFinishMarker(data: Message.FinishMarker) {
		if (!this.sequencer) {
			return;
		}
		if (data.time === null) {
			this.sequencer.sendEventToClientAt(
				this.myClient,
				{
					type: SequencerEventTypes.Timer,
					data: -1,
				},
				0,
				false
			);
		} else {
			const tick = this.startTime + data.time;
			// console.log(`[onFinishMarker] queue finish marker at ${tick}`);
			this.eventQueue.push({
				client: this.myClient,
				data: {
					type: SequencerEventTypes.Timer,
					data: -1,
				},
				tick,
			});
			this.sorted = false;
		}
	}

	private onUserMarker(data: Message.UserMarker) {
		if (!this.sequencer) {
			return;
		}

		const id = this.userMsgMapId++;
		this.userMsgMap[id] = { userMarker: `um-${data.marker}` };

		if (data.time === null) {
			this.sequencer.sendEventToClientAt(
				this.myClient,
				{
					type: SequencerEventTypes.Timer,
					data: id,
				},
				0,
				false
			);
		} else {
			const tick = this.startTime + data.time;
			this.eventQueue.push({
				client: this.myClient,
				data: {
					type: SequencerEventTypes.Timer,
					data: id,
				},
				tick,
			});
			this.sorted = false;
		}
	}

	private async onResetTime(_e: Message.ResetTime) {
		if (!this.sequencer) {
			return;
		}
		const tick = await this.sequencer.getTick();
		this.startTime = tick;
	}

	private onRenderMessage(data: RenderMessage.AllTypes) {
		switch (data.type) {
			case 'rendered':
				this.queuedFrames += data.data.outFrames;
				this.queuedTime = this.queuedFrames / data.data.sampleRate;
				this.port.postMessage(data);
				break;
			case 'status':
				this.port.postMessage(data);
				if (data.data.isQueueEmpty && this.allRendered) {
					// Start timeout for waiting for 'stop' user-marker
					// (This might not be necessary if 'finish' marker is processed correctly)
					if (this.renderEnabled) {
						this.finishTimer = this.timer.set(
							this.onStopForFinishTimeout.bind(this),
							3000
						);
					}
				}
				break;
			case 'queue':
				this.pauseRender = data.data.pause;
				break;
			case 'pause':
				this.postMessage({
					type: 'pause',
					id: data.data.id,
					data: data.data.paused,
				});
				break;
			case 'user-marker-resp':
				if (/^um-/.test(data.data.marker)) {
					const newData: typeof data = {
						type: 'user-marker-resp',
						data: {
							marker: data.data.marker.substring(3),
							framesBeforeMarker: data.data.framesBeforeMarker,
							sampleRate: data.data.sampleRate,
						},
					};
					this.port.postMessage(newData);
				} else {
					switch (data.data.marker) {
						case 'stop':
							// console.log(`[PlayerImpl] stop marker`);
							if (this.hasFinished) {
								this.onStopForFinish(
									Math.floor(
										data.data.framesBeforeMarker /
											data.data.sampleRate
									)
								);
							}
							break;
					}
				}
				break;
		}
	}
}
