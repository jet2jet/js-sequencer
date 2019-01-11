
import ISequencer from 'js-synthesizer/ISequencer';
import ISequencerEventData from 'js-synthesizer/ISequencerEventData';
import SequencerEvent, { EventType as SequencerEventTypes } from 'js-synthesizer/SequencerEvent';
import Synthesizer from 'js-synthesizer/Synthesizer';
import SynthesizerSettings from 'js-synthesizer/SynthesizerSettings';

declare var JSSynth: typeof import('js-synthesizer');

import * as Message from 'types/MessageData';
import * as RenderMessage from 'types/RenderMessageData';
import * as Response from 'types/ResponseData';

const enum Defaults {
	SampleRate = 48000,
	FramesCount = 8192,
	Interval = 40,
	Gain = 1
}

declare var Module: any;

let promiseWasmInitialized: Promise<void>;

function waitForWasmInitialized() {
	if (!promiseWasmInitialized) {
		promiseWasmInitialized = Promise.resolve().then(() => new Promise<void>((resolve) => {
			if (Module.calledRun) {
				resolve();
			} else {
				const fn = Module.onRuntimeInitialized;
				Module.onRuntimeInitialized = () => {
					resolve();
					if (fn) {
						fn();
					}
				};
			}
		}));
	}
	return promiseWasmInitialized;
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMilliseconds: number) {
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

export default class PlayerImpl {

	private port: MessagePort;
	private renderPort: MessagePort | undefined;
	private synth!: Synthesizer;
	private sequencer: ISequencer | undefined;
	private myClient!: number;
	private timerId: ReturnType<typeof setTimeout> | null = null;
	private pauseRender: boolean;
	private startTime: number;
	private hasFinished: boolean;
	private waitingForStop: boolean;
	private allRendered: boolean;
	private finishTimer: ReturnType<typeof setTimeout> | null = null;

	private midiChannelCount: number;
	private sampleRate: number;
	private timerInterval: number;
	private framesCount: number;
	private gain: number;
	private channel16IsDrums: boolean;

	private eventQueue: Array<{
		client: number;
		data: SequencerEvent;
		tick: number;
	}> = [];
	private queuedFrames: number = 0;
	private queuedTime: number = 0;

	private sysMsgMap: {
		[id: number]: Uint8Array
	} = {};
	private sysMsgMapId: number = 0;

	private onRenderMessageBind: PlayerImpl['onRenderMessage'];

	constructor(data: Message.Initialize) {
		this.port = data.port;
		this.pauseRender = false;
		this.startTime = 0;
		this.hasFinished = false;
		this.waitingForStop = false;
		this.allRendered = false;

		this.sampleRate = data.sampleRate || Defaults.SampleRate;
		this.midiChannelCount = Math.ceil(((data.channelCount || 16) + 15) / 16) * 16;
		this.timerInterval = Defaults.Interval;
		this.framesCount = Defaults.FramesCount;
		this.gain = Defaults.Gain;
		this.channel16IsDrums = false;

		this.onRenderMessageBind = this.onRenderMessage.bind(this);

		this.doInitialize(data).catch((e) => { console.error(e); throw e; });
	}

	private doInitSynth() {
		const obj: SynthesizerSettings = {
			midiChannelCount: this.midiChannelCount
		};
		this.synth.init(this.sampleRate, obj);
		this.synth.setGain(this.gain);

		// console.log('  synthesizer initialized.');
		this.postDefaultAsync('reset');
	}

	private async doInitialize(data: Message.Initialize) {
		// console.log('Wait for wasm initialized...');
		await waitForWasmInitialized();
		// console.log('  ok.');

		this.port.addEventListener('message', this.onMessage.bind(this));
		this.port.start();

		this.synth = new JSSynth.Synthesizer();
		this.doInitSynth();

		this.doConfigure(data);

		this.postDefaultResponse(data.id, 'initialize');
		// console.log('Initialize done.');
	}

	private doConfigure(data: Message.ConfigBase) {
		if (typeof data.interval !== 'undefined') {
			this.timerInterval = data.interval;
			if (this.timerId !== null) {
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
		this.timerId = setTimeout(this.onRender.bind(this), this.timerInterval);
	}

	private doStopTimer() {
		if (this.timerId !== null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}

	private doSendEvents() {
		const q = this.eventQueue;
		const toTime = (this.queuedTime + 5) * 1000 + this.startTime;
		// console.log(`[doSendEvents] q.length = ${q.length}, toTime = ${toTime}`);
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
		}
	}

	private resetSynth() {
		if (this.renderPort) {
			this.renderPort.postMessage({ type: 'release' } as RenderMessage.Release);
			this.renderPort.close();
			this.renderPort.removeEventListener('message', this.onRenderMessageBind);
			this.renderPort = void 0;
		}
		if (this.sequencer) {
			// console.log('Unregistereing clients from sequencer and close sequencer...');
			this.sequencer.close();
			this.sequencer = void 0;
		}
		this.doInitSynth();
	}

	private postMessage(data: Response.AllTypes, transfer?: Transferable[]) {
		this.port.postMessage(data, transfer);
	}

	private postDefaultResponse(id: number, messageType: Response.NoResponseMessageTypes) {
		this.postMessage({ id: id, type: messageType });
	}

	private postDefaultAsync(messageType: Response.AsyncMessageTypes) {
		this.postMessage({ type: messageType });
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
				this.hasFinished = true;
				this.synth.midiAllSoundsOff();
				this.finishTimer = setTimeout(this.onStopForFinish.bind(this), 2000);
			} else {
				const data = this.sysMsgMap[id];
				if (data) {
					delete this.sysMsgMap[id];
					this.synth.midiSysEx(data);
				}
			}
		}
	}

	private onStopForFinish() {
		this.finishTimer = null;
		if (!this.allRendered) {
			this.allRendered = true;
		}
	}

	private onRender() {
		this.timerId = setTimeout(this.onRender.bind(this), this.timerInterval);
		if (this.pauseRender || this.allRendered) {
			return;
		}

		this.doSendEvents();

		const size = this.framesCount;
		const buffers: [ArrayBuffer, ArrayBuffer] = [
			new ArrayBuffer(size * 4),
			new ArrayBuffer(size * 4)
		];
		this.synth.render(buffers.map((buffer) => new Float32Array(buffer)));

		const data: RenderMessage.Render = {
			type: 'render',
			data: buffers
		};
		this.renderPort!.postMessage(data, buffers);

		if (!this.synth.isPlaying() && this.hasFinished) {
			this.allRendered = true;
		}
	}

	private onMessage(e: MessageEvent) {
		const data: Message.AllTypes = e.data;
		switch (data.type) {
			case 'close':
				this.onClose();
				break;
			case 'config':
				this.onConfigure(data);
				break;
			case 'load-sfont':
				this.onLoadSoundfont(data);
				break;
			case 'unload-sfont':
				this.onUnloadSoundfont(data);
				break;
			case 'start':
				this.onStart(data);
				break;
			case 'stop':
				this.onStop();
				break;
			case 'release':
				this.onRelease(data);
				break;
			case 'event':
				this.onEvent(data);
				break;
			case 'sysex':
				this.onSysEx(data);
				break;
			case 'finish':
				this.onFinishMarker(data);
				break;
		}
	}

	private onClose() {
		this.doStopTimer();
		if (this.renderPort) {
			this.renderPort.postMessage({ type: 'release' } as RenderMessage.Release);
			this.renderPort.close();
			this.renderPort = void 0;
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
			data: sfontId
		});
	}

	private onUnloadSoundfont(data: Message.UnloadSoundfont) {
		this.synth.unloadSFont(data.sfontId);
		this.postDefaultResponse(data.id, 'unload-sfont');
	}

	private async onStart(data: Message.Start) {
		if (this.waitingForStop || (!data.renderPort && !this.renderPort)) {
			this.postDefaultAsync('stop');
			return;
		}

		if (!this.sequencer) {
			// console.log('Wait for create sequencer...');
			const seq = await JSSynth.Synthesizer.createSequencer();
			// console.log('  ok.');
			this.sequencer = seq;
			seq.registerSynthesizer(this.synth);
			this.myClient = JSSynth.Synthesizer.registerSequencerClient(
				seq,
				'js-sequencer',
				this.onSequencerCallback.bind(this),
				0
			);
		}

		const tick = await this.sequencer.getTick();
		// console.log('[PlayerImpl] start tick:', tick, this.finishTimer);
		this.pauseRender = false;
		this.hasFinished = false;
		this.allRendered = false;
		this.eventQueue = [];
		this.queuedFrames = 0;
		this.queuedTime = 0;
		this.startTime = tick;
		if (data.renderPort) {
			this.renderPort = data.renderPort;
			data.renderPort.addEventListener('message', this.onRenderMessageBind);
			data.renderPort.start();
		}

		this.synth.midiSystemReset();
		this.synth.setChannelType(15, this.channel16IsDrums);

		this.doStartTimer();
	}

	private async onStop() {
		const isWaitingFinish = this.hasFinished;
		// console.log('[PlayerImpl] onStop():', isWaitingFinish);
		if (this.finishTimer !== null) {
			clearTimeout(this.finishTimer);
			this.finishTimer = null;
		}
		if (this.sequencer && this.timerId !== null) {
			this.doStopTimer();
			this.renderPort!.postMessage({ type: 'stop' } as RenderMessage.Stop);
			if (this.synth.isPlaying()) {
				this.sequencer.removeAllEvents();
				this.sequencer.sendEventAt({
					type: 'system-reset'
				}, 0, false);
				this.waitingForStop = true;
				// console.log('Waiting for voices stopped...');
				try {
					await promiseWithTimeout(this.synth.waitForVoicesStopped(), 5000);
				} catch (_e) {
					// voice will not stopped, so re-initialize to reset
					this.resetSynth();
				}
				this.waitingForStop = false;
				this.postDefaultAsync('stop');
			} else if (isWaitingFinish) {
				// In this case 'this.synth' is not playing but playing process is still active.
				this.postDefaultAsync('stop');
			}
			// console.log('  Done.');
		}
	}

	private async onRelease(data: Message.Release) {
		// console.log('[PlayerImpl] onRelease()');
		if (this.sequencer) {
			if (this.timerId !== null) {
				await this.onStop();
			}
			if (this.renderPort) {
				this.renderPort.postMessage({ type: 'release' } as RenderMessage.Release);
				this.renderPort.close();
				this.renderPort.removeEventListener('message', this.onRenderMessageBind);
				this.renderPort = void 0;
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
				tick: tick
			});
		}
	}

	private onSysEx(data: Message.SysEx) {
		if (!this.sequencer) {
			return;
		}
		const bin = new Uint8Array(data.data);
		const id = this.sysMsgMapId++;
		this.sysMsgMap[id] = bin;

		if (data.time === null) {
			this.sequencer.sendEventToClientAt(this.myClient, {
				type: SequencerEventTypes.Timer,
				data: id
			}, 0, false);
		} else {
			const tick = this.startTime + data.time;
			this.eventQueue.push({
				client: this.myClient,
				data: {
					type: SequencerEventTypes.Timer,
					data: id
				},
				tick: tick
			});
		}
	}

	private onFinishMarker(data: Message.FinishMarker) {
		if (!this.sequencer) {
			return;
		}
		if (data.time === null) {
			this.sequencer.sendEventToClientAt(this.myClient, {
				type: SequencerEventTypes.Timer,
				data: -1
			}, 0, false);
		} else {
			const tick = this.startTime + data.time;
			// console.log(`[onFinishMarker] queue finish marker at ${tick}`);
			this.eventQueue.push({
				client: this.myClient,
				data: {
					type: SequencerEventTypes.Timer,
					data: -1
				},
				tick: tick
			});
		}
	}

	private onRenderMessage(e: MessageEvent) {
		const data: RenderMessage.AllTypes = e.data;
		if (!data) {
			return;
		}
		switch (data.type) {
			case 'rendered':
				this.queuedFrames += data.data.outFrames;
				this.queuedTime = this.queuedFrames / data.data.sampleRate;
				this.port.postMessage(data);
				break;
			case 'status':
				this.port.postMessage(data);
				if (data.data.isQueueEmpty && this.allRendered) {
					this.onStop();
					this.postDefaultAsync('stop');
				}
				break;
			case 'queue':
				this.pauseRender = data.data.pause;
				break;
		}
	}
}
