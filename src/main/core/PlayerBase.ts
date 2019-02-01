
import * as JSSynth from 'js-synthesizer';

import {  TimeValue } from 'types';

import PlayerBaseEventObjectMap from 'events/PlayerBaseEventObjectMap';
import PlayStatusEventObject from 'events/PlayStatusEventObject';
import PlayUserEventObject from 'events/PlayUserEventObject';
import SimpleEventObject from 'events/SimpleEventObject';

import { isAudioAvailable, loadBinaryFromFile } from 'functions';

import IPlayStream from 'core/IPlayStream';

import Options from 'core/playing/Options';
import PlayerProxy from 'core/playing/PlayerProxy';

interface UserEventData {
	type: string;
	data: any;
}

// same as << import { StatusData } from 'types/RenderMessageData'; >>
export interface StatusData {
	outFrames: number;
	sampleRate: number;
	isQueueEmpty: boolean;
}

export interface SFontMap {
	targetBank: number;
	targetPreset: number;
	/** soundfont identifier or -1 for default soundfont */
	sfontId: number;
	bank: number;
	preset: number;
}

interface ChannelStatus {
	bank?: number;
	preset?: number;
	volume: number;
}

declare var WebAssembly: any;

const enum Constants {
	PlayVolume = 0.5,
	PrerenderTime = 8,
	StopWaitTime = 5,
	DefaultInterval = 30,
	SampleRate = 48000,
	FramesCount = 8192,
	MaxEventCountPerRender = 50,
	DefaultFadeoutStep = 10,
	DefaultFadeoutTime = 4,
	DefaultFadeoutStartTime = 0,

	InitialVolume = 12800,  // 100 * 0x80

	ChannelCount = 32,

	ChannelSingleNote = 16,
	ChannelRootNote = 17,
	ChannelChordNote = 18
}

function makeDefaultChannelStatus(): ChannelStatus {
	return {
		volume: Constants.InitialVolume
	};
}

/**
 * Process and render MIDI-related events.
 *
 * The instance must be created with PlayerBase.instantiate.
 */
export default class PlayerBase {
	protected channels: ChannelStatus[] = [];

	private proxy: PlayerProxy;
	private sfontDefault: number | null = null;
	private isSfontDefaultExternal: boolean = false;
	private sfontMap: SFontMap[] = [];
	private masterVolume: number = Constants.PlayVolume;
	private channel16IsDrums: boolean = false;
	private releasePlayerTimer: number | null = null;
	private outputStream: IPlayStream | null = null;
	private audioWorkletScripts: string[] = [];

	private _evtPlayStatus: Array<(e: PlayStatusEventObject) => void> = [];
	private _evtStopped: Array<(e: SimpleEventObject<PlayerBase>) => void> = [];
	private _evtReset: Array<(e: SimpleEventObject<PlayerBase>) => void> = [];
	private _evtPlayUserEvent: Array<(e: PlayUserEventObject) => void> = [];

	private playOptions: Options = {};
	private playingStream: IPlayStream | null = null;
	private audio: BaseAudioContext | null = null;
	private audioDest: AudioNode | null = null;
	private playingNode: AudioNode | null = null;
	private playingGain: GainNode | null = null;
	private _isPlayerRunning: boolean = false;
	private isNodeConnected = false;
	private isWorkletLoaded = false;

	private playedFrames: number = 0;
	private isWaitingForStop: boolean = false;

	protected constructor(proxy: PlayerProxy) {
		this.proxy = proxy;
		proxy.onQueued = this.onQueuedPlayer.bind(this);
		proxy.onStatus = this.onStatusPlayer.bind(this);
		proxy.onStop = this.onFinishPlayer.bind(this);
		proxy.onReset = this.onResetPlayer.bind(this);
		proxy.onUserData = this.onUserDataPlayer.bind(this);
	}

	public static isSupported() {
		return typeof AudioContext !== 'undefined' && typeof WebAssembly !== 'undefined';
	}

	public static isAudioWorkletSupported() {
		return typeof AudioWorkletNode !== 'undefined';
	}

	/**
	 * Create the player-base instance.
	 * @param workerJs worker script file which includes js-sequencer's worker code
	 * @param depsJs dependency JS files which workerJs (and js-sequencer's worker) uses
	 * @param interval timer interval for worker processing (default: 30)
	 * @param framesCount output frame count per one render process (default: 8192)
	 * @param sampleRate audio sample rate (default: 48000)
	 * @return Promise object which resolves with PlayerBase instance when initialization is done
	 */
	public static instantiatePlayerBase(
		workerJs: string,
		depsJs: string[],
		shareWorker?: boolean,
		interval?: number,
		framesCount?: number,
		sampleRate?: number
	): Promise<PlayerBase> {
		return PlayerBase.instantiateProxy(
			workerJs, depsJs, shareWorker, interval, framesCount, sampleRate
		).then((p) => new PlayerBase(p));
	}

	protected static instantiateProxy(
		workerJs: string,
		depsJs: string[],
		shareWorker?: boolean,
		interval?: number,
		framesCount?: number,
		sampleRate?: number,
		channelCount?: number
	) {
		if (typeof Promise === 'undefined') {
			throw new Error('Unsupported');
		}
		if (typeof interval === 'undefined') {
			interval = Constants.DefaultInterval;
		}
		if (typeof framesCount === 'undefined') {
			framesCount = Constants.FramesCount;
		}
		if (typeof sampleRate === 'undefined') {
			sampleRate = Constants.SampleRate;
		}
		return PlayerProxy.instantiate(
			shareWorker, workerJs, depsJs, interval, framesCount, sampleRate, channelCount || 16
		);
	}

	/**
	 * Close and release the player.
	 * After called, all methods will not be usable and those behavior will be undefined.
	 */
	public close() {
		this.proxy.close();
	}

	/**
	 * Load main soundfont data.
	 * @param bin soundfont binary data
	 * @return Promise object which resolves when loading process is done
	 */
	public loadSoundfont(bin: ArrayBuffer) {
		return this.unloadSoundfont()
			.then(() => this.proxy.loadSoundfont(bin))
			.then((id) => { this.sfontDefault = id; });
	}

	/**
	 * Load main soundfont data from 'input type="file"' element.
	 * @param fileElemId file element ID or file element instance itself
	 * @return Promise object which resolves when loading process is done
	 */
	public loadSoundfontFromFile(fileElemId: string | HTMLInputElement) {
		return loadBinaryFromFile(fileElemId).then((bin) => this.loadSoundfont(bin));
	}

	/**
	 * Unload main soundfont data.
	 */
	public unloadSoundfont() {
		if (this.sfontDefault === null) {
			return Promise.resolve();
		}
		if (this.isSfontDefaultExternal) {
			this.sfontDefault = null;
			this.isSfontDefaultExternal = false;
			return Promise.resolve();
		}
		return this.proxy.unloadSoundfont(this.sfontDefault).then(() => {
			this.sfontDefault = null;
		});
	}

	public isSoundfontLoaded() {
		return this.sfontDefault !== null;
	}

	/**
	 * Use loaded soundfont as a default soundfont. The old default soundfont
	 * will be unloaded if not specified by 'useSoundfont'.
	 * @param sfontId soundfont identifier (returned by addSoundfontForMap or addSoundfontForMapFromFile).
	 *     To unset, specify null or undefined.
	 */
	public useSoundfont(sfontId: number | null | undefined) {
		if (this.sfontDefault !== null && !this.isSfontDefaultExternal) {
			this.proxy.unloadSoundfont(this.sfontDefault);
		}
		if (typeof sfontId === 'number') {
			this.sfontDefault = sfontId;
			this.isSfontDefaultExternal = true;
		} else {
			this.sfontDefault = null;
			this.isSfontDefaultExternal = false;
		}
	}

	/**
	 * Add soundfont data to use with addPresetMapWithSoundfont().
	 * @param sfontBin soundfont binary data
	 * @return Promise object which resolves with soundfont identifier when succeeded
	 */
	public addSoundfontForMap(sfontBin: ArrayBuffer) {
		return this.proxy.loadSoundfont(sfontBin).then((sfontId) => {
			this.sfontMap.push({
				targetBank: -1,
				targetPreset: -1,
				sfontId: sfontId,
				bank: 0,
				preset: 0
			});
			return sfontId;
		});
	}

	/**
	 * Add soundfont data from file element, to use with addPresetMapWithSoundfont().
	 * @param fileElemId file element ID or file element instance itself
	 * @return Promise object which resolves with soundfont identifier when succeeded
	 */
	public addSoundfontForMapFromFile(fileElemId: string | HTMLInputElement) {
		return loadBinaryFromFile(fileElemId).then((bin) => this.addSoundfontForMap(bin));
	}

	/**
	 * Add preset mapping for replacing specific bank/preset with soundfont one.
	 * @param sfont soundfont identifier (returned by addSoundfontForMap(fromFile) method), or
	 *     -1 to use main soundfont for mapping
	 * @param targetBank target bank number to replace (including LSB value)
	 * @param targetPreset target preset number to replace
	 * @param bank new bank number defined in specified soundfont
	 * @param preset new preset number defined in specified soundfont
	 */
	public addPresetMapWithSoundfont(
		sfont: number,
		targetBank: number,
		targetPreset: number,
		bank: number,
		preset: number
	) {
		if (targetBank < 0) {
			throw new Error('Invalid \'targetBank\' value');
		}
		if (targetPreset < 0) {
			throw new Error('Invalid \'targetPreset\' value');
		}
		if (sfont < 0) {
			sfont = -1;
		} else if (!this.sfontMap.filter((m) => m.sfontId === sfont)[0]) {
			throw new Error('Invalid \'sfont\' value');
		}
		const a = this.sfontMap.filter(
			(m) => m.sfontId === sfont && m.targetBank === targetBank && m.targetPreset === targetPreset
		)[0];
		if (a) {
			a.bank = bank;
			a.preset = preset;
		} else {
			this.sfontMap.push({
				targetBank: targetBank,
				targetPreset: targetPreset,
				sfontId: sfont,
				bank: bank,
				preset: preset
			});
		}
	}

	/**
	 * Return all preset mappings.
	 */
	public getAllMaps() {
		return this.sfontMap.slice(0);
	}

	/**
	 * Return all preset mappings for the soundfont.
	 * @param sfont soundfont identifier or -1 for using main soundfont
	 */
	public getAllMapForSoundfont(sfont: number) {
		if (sfont < 0) {
			sfont = -1;
		}
		return this.sfontMap.filter(
			(m) => (m.sfontId === sfont && m.targetBank >= 0 && m.targetPreset >= 0)
		).map(
			(m) => ({
				targetBank: m.targetBank,
				targetPreset: m.targetPreset,
				bank: m.bank,
				preset: m.preset
			})
		);
	}

	/**
	 * Remove program map for specified target program
	 * @param sfont soundfont value (returned by addSoundfontForMap)
	 * @param targetBank target to remove map, or omit/undefined to remove all target using the soundfont
	 * @param targetPreset target to remove map, or omit/undefined to remove all target using the soundfont
	 * @return true if the soundfont is used by another target, or false if unloaded
	 */
	public removeProgramMap(sfont: number, targetBank?: number, targetPreset?: number) {
		if (sfont < 0) {
			sfont = -1;
		}
		const removeAll = (typeof targetBank === 'undefined');
		let found = false;
		let remainSFont = false;
		let mapSFontEmptyIndex = -1;
		for (let i = this.sfontMap.length - 1; i >= 0; --i) {
			const m = this.sfontMap[i];
			if (m.sfontId === sfont) {
				if (m.targetBank < 0) {
					mapSFontEmptyIndex = i;
				} else {
					found = true;
					if (removeAll || (m.targetBank === targetBank && (
						typeof targetPreset === 'undefined' || m.targetPreset === targetPreset
					))) {
						this.sfontMap.splice(i, 1);
					} else {
						remainSFont = true;
					}
				}
			}
		}
		if (found && !remainSFont) {
			if (sfont >= 0) {
				if (mapSFontEmptyIndex >= 0) {
					this.sfontMap.splice(mapSFontEmptyIndex, 1);
				}
				if (this.sfontDefault === sfont) {
					if (this.isSfontDefaultExternal) {
						this.isSfontDefaultExternal = false;
						this.sfontDefault = null;
						this.proxy.unloadSoundfont(sfont);
					}
				} else {
					this.proxy.unloadSoundfont(sfont);
				}
			}
			return false;
		} else {
			return true;
		}
	}

	/**
	 * Reset (Remove) all registered program maps.
	 * If keepSfontLoaded is not true, the associated soundfonts are unloaded.
	 * @param keepSfontLoaded true if the loaded soundfonts are not unloaded
	 */
	public resetAllProgramMap(keepSfontLoaded?: boolean) {
		const map = this.sfontMap;
		for (let i = map.length - 1; i >= 0; --i) {
			const m = map[i];
			if (m.targetBank < 0 && m.targetPreset < 0) {
				if (!keepSfontLoaded && m.sfontId >= 0) {
					this.proxy.unloadSoundfont(m.sfontId);
					map.splice(i, 1);
				}
			} else {
				map.splice(i, 1);
			}
		}
	}

	protected onQueuedPlayer(_s: StatusData) {
		// console.log('onQueuedPlayer:', this.renderedTime, this.renderedFrames);
	}

	private onStatusPlayer(s: StatusData) {
		this.playedFrames += s.outFrames;
		// console.log('onStatusPlayer:', this.playedFrames / s.sampleRate, this.playedFrames);

		this.raiseEventPlayStatus(this.playedFrames, s.sampleRate);
	}

	private onFinishPlayer() {
		// console.log('[PlayerBase] onFinishPlayer', this.isWaitingForStop);
		if (!this.isWaitingForStop) {
			this.stopAndWait();
		}
	}

	private onResetPlayer() {
		this.sfontDefault = null;
		this.isSfontDefaultExternal = false;
		this.sfontMap = [];
		this.raiseEventReset();
	}

	private onUserDataPlayer(data: any) {
		const e: UserEventData = data;
		if (!e) {
			return;
		}
		this.raiseEventPlayUserEvent(e.type, e.data);
	}

	private raiseEventPlayStatus(current: number, sampleRate: number) {
		const e = new PlayStatusEventObject(this, current, sampleRate);
		for (const fn of this._evtPlayStatus) {
			fn(e);
			if (e.isPropagationStopped())
				break;
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventPlayUserEvent(type: string, data: any) {
		const e = new PlayUserEventObject(this, type, data);
		for (const fn of this._evtPlayUserEvent) {
			fn(e);
			if (e.isPropagationStopped()) {
				break;
			}
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventStopped() {
		const e = new SimpleEventObject(this);
		for (const fn of this._evtStopped) {
			fn(e);
			if (e.isPropagationStopped())
				break;
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventReset() {
		const e = new SimpleEventObject(this);
		for (const fn of this._evtReset) {
			fn(e);
			if (e.isPropagationStopped())
				break;
		}
		return !e.isDefaultPrevented();
	}

	/**
	 * Add the event handler for the player.
	 * @param name event name
	 * @param fn event handler
	 */
	public addEventHandler<T extends keyof PlayerBaseEventObjectMap>(
		name: T, fn: (e: PlayerBaseEventObjectMap[T]) => void
	): void {
		let arr: any[] | undefined;
		switch (name.toLowerCase()) {
			case 'reset': arr = this._evtReset; break;
			case 'stopped': arr = this._evtStopped; break;
			case 'playstatus': arr = this._evtPlayStatus; break;
			case 'playuserevent': arr = this._evtPlayUserEvent; break;
		}
		if (!arr) {
			return;
		}
		arr.push(fn);
	}
	/**
	 * Remove the event handler from the player.
	 * @param name event name
	 * @param fn registered event handler
	 */
	public removeEventHandler<T extends keyof PlayerBaseEventObjectMap>(
		name: T, fn: (e: PlayerBaseEventObjectMap[T]) => void
	): void {
		let arr: any[] | undefined;
		switch (name.toLowerCase()) {
			case 'reset': arr = this._evtReset; break;
			case 'stopped': arr = this._evtStopped; break;
			case 'playstatus': arr = this._evtPlayStatus; break;
			case 'playuserevent': arr = this._evtPlayUserEvent; break;
		}
		if (!arr) {
			return;
		}
		for (let i = arr.length - 1; i >= 0; --i) {
			if (arr[i] === fn) {
				arr.splice(i, 1);
				break;
			}
		}
	}

	public getPlayOptions(): Readonly<Options> {
		return { ...this.playOptions };
	}

	public setPlayOptions(options: Readonly<Options>) {
		this.playOptions = { ...options };
	}

	private resetChannel() {
		this.channels = [];
	}

	private prepareAudioContext(actxBase?: BaseAudioContext | null) {
		let actx = this.audio;
		const useAudioWorklet = this.audioWorkletScripts.length > 0;
		if (actxBase) {
			if (actx && actxBase !== actx) {
				this.releasePlayer();
				this.isWorkletLoaded = false;
			}
			this.audio = actx = actxBase;
		} else if (!actx) {
			actx = this.audio = new AudioContext();
			this.isWorkletLoaded = false;
		}
		if (useAudioWorklet && !this.isWorkletLoaded) {
			const fnNext = (a: BaseAudioContext, s: string[], i: number): Promise<BaseAudioContext> => {
				return a.audioWorklet.addModule(s[i]).then(() => {
					if (i === s.length - 1) {
						this.isWorkletLoaded = true;
						return a;
					}
					return fnNext(a, s, i + 1);
				});
			};
			return fnNext(actx, this.audioWorkletScripts, 0);
		}
		return Promise.resolve(actx);
	}

	private prepareForPlay(actx: BaseAudioContext, dest: AudioNode) {
		this.resetChannel();
		if (this.releasePlayerTimer !== null) {
			clearTimeout(this.releasePlayerTimer);
			this.releasePlayerTimer = null;
		}
		if (this.outputStream) {
			if (this.playingStream && this.playingStream === this.outputStream) {
				this.proxy.startWithExistingConnection();
			} else {
				if (this.playingStream) {
					this.proxy.releasePlayer();
				}
				this.proxy.startForStream(this.outputStream, this.playOptions);
				this.playingStream = this.outputStream;
			}
		} else {
			let doConnect = !this.isNodeConnected;
			let gain = this.playingGain;
			if (!gain) {
				gain = this.playingGain = actx.createGain();
				gain.gain.value = this.masterVolume;
				this.audioDest = null;
			}
			if (this.audioDest !== dest) {
				gain.connect(dest);
				this.audioDest = dest;
				doConnect = true;
			}
			let node = this.playingNode;
			if (node) {
				this.proxy.startWithExistingConnection();
			} else {
				const useAudioWorklet = (this.audioWorkletScripts.length > 0);
				node = useAudioWorklet ? this.proxy.startWithAudioWorkletNode(actx, this.playOptions) :
					this.proxy.startWithScriptProcessorNode(actx, this.playOptions);
				this.playingNode = node;
				doConnect = true;
			}
			if (doConnect) {
				node.connect(gain);
				this.isNodeConnected = true;
			}
		}

		// Reset program.
		// This is necessary because the default soundfont of synthesizer is
		// always the last loaded soundfont and cannot be changed
		for (let channel = 0; channel < Constants.ChannelChordNote; ++channel) {
			const isDrum = (channel === 9 || (this.channel16IsDrums && channel === 15));
			const bank = isDrum ? 128 : 0;
			this.proxy.sendEventNow({
				type: JSSynth.SequencerEventTypes.EventType.ProgramSelect,
				channel: channel,
				sfontId: this.sfontDefault!,
				bank: bank,
				preset: 0
			});
		}

		this._isPlayerRunning = true;

		this.playedFrames = 0;
		this.isWaitingForStop = false;

		this.onPlayStart();
	}

	/**
	 * Send a sequencer event, especially MIDI-based event.
	 * @param ev an event data
	 * @param time time to render the event or null to send immediately
	 * @return true if the event is sent, or false if not
	 *     (indicating render process has been stopped)
	 */
	public sendEvent(ev: JSSynth.SequencerEvent, time?: TimeValue | null | undefined) {
		switch (ev.type) {
			case JSSynth.EventType.ProgramChange:
				return this.doChangeProgram(ev.channel, ev.preset, time);
			case JSSynth.EventType.ProgramSelect:
				return this.doChangeProgram(ev.channel, ev.preset, time, ev.bank, ev.sfontId);
			case JSSynth.EventType.ControlChange:
				if (ev.control === 0x07 || ev.control === 0x27) {
					return this.changeVolume(ev.channel, ev.control === 0x07, ev.value, time);
				}
				break; // use default processing
		}
		return this.doSendEvent({ ...ev }, time);
	}

	public sendSysEx(rawData: Uint8Array, time?: TimeValue | null | undefined) {
		const data = { rawData };
		if (!this.preSendSysEx(data, time)) {
			return false;
		}
		if (!data.rawData || !data.rawData.length) {
			return true;
		}
		if (typeof time === 'undefined' || time === null) {
			this.proxy.sendSysExNow(data.rawData);
		} else {
			this.proxy.sendSysEx(data.rawData, time * 1000);
		}
		return true;
	}

	/**
	 * Send a user-defined event to sequencer.
	 * 'playuserevent' event will be raised when the user-defined event is
	 * to be rendered.
	 * @param type user-defined event type
	 * @param time time to render the event (null/undefined is not allowed)
	 * @param data any data for the event
	 */
	public sendUserEvent(type: string, time: TimeValue, data?: any) {
		this.proxy.sendUserData({
			type: type,
			data: data
		} as UserEventData, time * 1000);
	}

	/**
	 * Send a 'finish' event to tell that render process has finished.
	 * After this, 'stopped' event will be raised.
	 */
	public sendFinish(time: TimeValue) {
		this.proxy.sendFinishMarker(time * 1000);
	}

	/**
	 * Send 'change program' event to the sequencer.
	 * @param channel MIDI channel number
	 * @param preset program/preset number
	 * @param bank bank number (null or undefined to use the current bank number)
	 * @param time time to render the event or null to send immediately
	 * @return true if the event is sent, or false if not
	 *     (indicating render process has been stopped)
	 */
	public changeProgram(channel: number, preset: number, bank?: number | null, time?: TimeValue | null) {
		return this.doChangeProgram(channel, preset, time, bank);
	}

	/**
	 * Send 'change volume' event to the sequencer.
	 * @param channel MIDI channel number
	 * @param isMSB true if the value is for MSB, or false if for LSB
	 * @param value the volume value (0-127)
	 * @param time time time to render the event or null to send immediately
	 * @return true if the event is sent, or false if not
	 *     (indicating render process has been stopped)
	 */
	public changeVolume(channel: number, isMSB: boolean, value: number, time?: TimeValue | null | undefined): boolean;
	/**
	 * Send 'change volume' event to the sequencer.
	 * @param channel MIDI channel number
	 * @param value the volume value (0-16383)
	 * @param time time time to render the event or null to send immediately
	 * @return true if the event is sent, or false if not
	 *     (indicating render process has been stopped)
	 */
	public changeVolume(channel: number, value: number, time?: TimeValue | null | undefined): boolean;

	public changeVolume(
		channel: number,
		arg2: boolean | number,
		arg3?: number | TimeValue | null | undefined,
		arg4?: TimeValue | null | undefined
	): boolean {
		const ch = this.channels[channel] || (this.channels[channel] = makeDefaultChannelStatus());
		let actualValue: number;
		if (typeof arg2 === 'number') {
			// arg2: actualValue (number)
			// arg3: time (TimeValue)
			actualValue = arg2;
			let ev: JSSynth.SequencerEventTypes.ControlChangeEvent = {
				type: JSSynth.SequencerEventTypes.EventType.ControlChange,
				channel: channel,
				control: 0x07,
				value: Math.floor(arg2 / 0x80)
			};
			if (!this.doSendEvent(ev, arg3 as (TimeValue | null | undefined))) {
				return false;
			}
			ev = {
				type: JSSynth.SequencerEventTypes.EventType.ControlChange,
				channel: channel,
				control: 0x27,
				value: (arg2 & 0x7F)
			};
			if (!this.doSendEvent(ev, arg3 as (TimeValue | null | undefined))) {
				return false;
			}
		} else {
			// arg2: isMSB (boolean)
			// arg3: value (number)
			// arg4: time (TimeValue)
			const value = arg3 as number;
			if (arg2) {
				actualValue = (ch.volume & 0x7F) + (value * 0x80);
			} else {
				actualValue = Math.floor(ch.volume / 0x80) * 0x80 + value;
			}

			const ev: JSSynth.SequencerEventTypes.ControlChangeEvent = {
				type: JSSynth.SequencerEventTypes.EventType.ControlChange,
				channel: channel,
				control: arg2 ? 0x07 : 0x27,
				value: value
			};
			if (!this.doSendEvent(ev, arg4)) {
				return false;
			}
		}

		ch.volume = actualValue;

		return true;
	}

	protected doSendEvent(ev: JSSynth.SequencerEvent, time: TimeValue | null | undefined, noHook?: boolean) {
		if (!noHook && !this.preSendEvent(ev, time)) {
			return false;
		}

		if (typeof time === 'undefined' || time === null) {
			this.proxy.sendEventNow(ev);
		} else {
			this.proxy.sendEvent(ev, time * 1000);
		}
		return true;
	}

	private doChangeProgram(
		channel: number,
		preset: number,
		time: TimeValue | null | undefined,
		bank?: number | null,
		sfontId?: number | null
	) {
		const ch = this.channels[channel] || (this.channels[channel] = makeDefaultChannelStatus());
		ch.preset = preset;
		if (typeof bank === 'number') {
			ch.bank = bank;
		}
		const isDrum = (channel === 9 || (this.channel16IsDrums && channel === 15));
		const bankCurrent = (typeof ch.bank === 'number' ? ch.bank : isDrum ? 128 : 0);
		let ev: JSSynth.SequencerEventTypes.ProgramSelectEvent | undefined;
		for (const m of this.sfontMap) {
			if (m.targetBank === bankCurrent && m.targetPreset === preset) {
				ev = {
					type: JSSynth.SequencerEventTypes.EventType.ProgramSelect,
					channel: channel,
					sfontId: m.sfontId < 0 ? this.sfontDefault! : m.sfontId,
					bank: m.bank,
					preset: m.preset
				};
				break;
			}
		}
		if (!ev) {
			ev = {
				type: JSSynth.SequencerEventTypes.EventType.ProgramSelect,
				channel: channel,
				sfontId: (typeof sfontId === 'number' ? sfontId : this.sfontDefault!),
				bank: bankCurrent,
				preset: preset
			};
		}
		return this.doSendEvent(ev, time);
	}

	/**
	 * Pause or resume rendering frames.
	 * @param paused true for pause, false for resume
	 * @return resolved with 'isPaused' value (same value with 'paused' parameter for almost all case)
	 */
	public pausePlaying(paused: boolean): Promise<boolean> {
		return this.proxy.pause(paused);
	}

	/**
	 * Start player engine to render MIDI events.
	 * @param actx AudioContext or OfflineAudioContext instance, or null to use default AudioContext instance
	 * @param dest destination AudioNode (null to use actx.destination).
	 *     Note that 'actx' parameter is ignored if dest is specified
	 * @param noStop true to prevent from stopping player first
	 */
	public startPlayer(
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null,
		noStop?: boolean
	) {
		if (!isAudioAvailable()) {
			return Promise.reject(new Error('Not supported'));
		}

		if (!noStop) {
			this.stopPlayer();
		}
		if (dest) {
			actx = dest.context;
		}
		return this.prepareAudioContext(actx).then((a) => this.prepareForPlay(a, dest || a.destination));
	}

	/**
	 * Stop rendering MIDI events for player engine.
	 */
	public stopPlayer() {
		if (!this._isPlayerRunning) {
			return;
		}
		this.preStopPlayer();
		if (!this.isWaitingForStop) {
			this.proxy.stop();
		}
		this._isPlayerRunning = false;
		if (this.playingNode) {
			this.playingNode.disconnect();
			this.isNodeConnected = false;
		}
		this.setReleaseTimer();
		this.isWaitingForStop = false;
		this.raiseEventStopped();
	}

	private stopAndWait() {
		if (!this._isPlayerRunning || this.isWaitingForStop) {
			return;
		}
		// console.log('[PlayerBase] stopAndWait', new Error());
		this.isWaitingForStop = true;
		this.proxy.stop();
		this.proxy.waitForFinish().then(() => {
			// console.log('All finished', this._isPlayerRunning);
			this.stopPlayer();
		});
	}

	/**
	 * Return whether the player is running (rendering).
	 */
	public isPlayerRunning() {
		return this._isPlayerRunning;
	}

	protected setReleaseTimer() {
		this.releasePlayerTimer = setTimeout(
			this._releasePlayerCallback.bind(this),
			Constants.StopWaitTime * 1000
		);
	}

	/**
	 * Release render-related objects explicitly.
	 * Note that the release process will be done automatically 5 seconds after when stopped.
	 * @param resetSynth true to release internal synthesizer instance
	 */
	public releasePlayer(resetSynth?: boolean) {
		this.preReleasePlayer();
		if (this.releasePlayerTimer !== null) {
			clearTimeout(this.releasePlayerTimer);
			this.releasePlayerTimer = null;
		}
		this.proxy.releasePlayer(resetSynth);
		if (this.playingStream) {
			this.playingStream = null;
		}
		if (this.playingNode) {
			this.playingNode.disconnect();
			this.playingNode = null;
		}
		if (this.playingGain) {
			this.playingGain.disconnect();
			this.playingGain = null;
		}
		if (this.audioDest) {
			this.audioDest = null;
		}
		if (this.audio) {
			this.audio = null;
			this.isWorkletLoaded = false;
		}
		if (this.isWaitingForStop) {
			this.isWaitingForStop = false;
			this.raiseEventStopped();
		}
	}

	private _releasePlayerCallback() {
		this.releasePlayerTimer = null;
		this.releasePlayer();
	}

	/**
	 * Return the current master volume for output with Web Audio.
	 */
	public getMasterVolume() {
		return this.masterVolume;
	}

	/**
	 * Set the master volume for output with Web Audio.
	 * This value does not affect to the render process with IPlayStream.
	 * When the render process is running, the volume value is updated immediately.
	 * @param value the volume/gain value (usually from 0.0 to 1.0, initial value is 0.5)
	 */
	public setMasterVolume(value: number) {
		this.masterVolume = value;
		if (this.playingGain) {
			this.playingGain.gain.value = value;
		}
	}

	/**
	 * Return whether the MIDI channel 16 (15 for zero-based index) is the drums part.
	 */
	public isChannel16IsDrums() {
		return this.channel16IsDrums;
	}

	/**
	 * Set whether the MIDI channel 16 (15 for zero-based index) is the drums part.
	 * This method does not update the configuration if the render process is running.
	 * @param value true if the MIDI channel 16 is the drums part
	 * @return a Promise object that resolves when the configuration has done
	 */
	public setChannel16IsDrums(value: boolean) {
		if (this._isPlayerRunning) {
			return Promise.resolve();
		}
		return this.proxy.configure({
			channel16IsDrums: value
		}).then(() => {
			this.channel16IsDrums = value;
		});
	}

	/**
	 * Set the script URLs for audio worklet processings.
	 * If nothing is set, the audio worklet is not used.
	 */
	public setAudioWorkletScripts(audioWorkletScripts: ReadonlyArray<string> | null | undefined) {
		if (typeof AudioWorkletNode === 'undefined') {
			return;
		}

		this.audioWorkletScripts = audioWorkletScripts ? audioWorkletScripts.slice(0) : [];
		this.isWorkletLoaded = false;
	}

	/**
	 * Set the audio frame count for render process.
	 */
	public setRenderFrameCount(count: number) {
		return this.proxy.configure({
			framesCount: count
		});
	}

	/**
	 * Set the gain value of the internal synthesizer.
	 * Unlike setMasterVolume, this value affects to the render process with IPlayStream.
	 * When the render process is running, the update process of
	 * the volume value is delayed and does not reflect to already rendered frames.
	 * @param value the gain value (usually from 0.0 to 1.0)
	 * @return a Promise object that resolves when the configuration has done
	 */
	public setSynthGain(value: number) {
		return this.proxy.configure({
			gain: value
		});
	}

	/**
	 * Set the user-defined output stream.
	 * If the stream is set, the render process will use it instead of Web Audio.
	 * When the render process is running, the stream will not be used until
	 * the playing is stopped.
	 * @param stream the output stream or null to reset
	 */
	public setOutputStream(stream: IPlayStream | null) {
		this.outputStream = stream;
	}

	protected onPlayStart() {
		// do nothing
	}
	protected preSendEvent(_ev: JSSynth.SequencerEvent, _time: TimeValue | null | undefined): boolean {
		// do nothing
		return true;
	}
	protected preSendSysEx(_data: { rawData: Uint8Array | null | undefined; }, _time: TimeValue | null | undefined): boolean {
		// do nothing
		return true;
	}
	protected preStopPlayer() {
		// do nothing
	}
	protected preReleasePlayer() {
		// do nothing
	}
}
