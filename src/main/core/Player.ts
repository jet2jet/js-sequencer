
import * as JSSynth from 'js-synthesizer';

import { FadeoutData, LoopData, TimeValue } from 'types';

import BackgroundChord from 'objects/BackgroundChord';
import IPositionObject from 'objects/IPositionObject';
import ISequencerObject from 'objects/ISequencerObject';
import PositionObject from 'objects/PositionObject';

import AftertouchControl from 'core/controls/AftertouchControl';
import ControllerControl from 'core/controls/ControllerControl';
import KeySignatureControl from 'core/controls/KeySignatureControl';
import PitchWheelControl from 'core/controls/PitchWheelControl';
import PressureControl from 'core/controls/PressureControl';
import ProgramChangeControl from 'core/controls/ProgramChangeControl';
import SysExControl from 'core/controls/SysExControl';
import SysMsgControl from 'core/controls/SysMsgControl';
import TempoControl from 'core/controls/TempoControl';
import TimeSignatureControl from 'core/controls/TimeSignatureControl';

import PlayEndNoteEventObject from 'events/PlayEndNoteEventObject';
import PlayerEventObjectMap from 'events/PlayerEventObjectMap';
import PlayQueueEventObject from 'events/PlayQueueEventObject';
import PlayStatusEventObject from 'events/PlayStatusEventObject';
import PlayUserEventObject from 'events/PlayUserEventObject';
import SimpleEventObject from 'events/SimpleEventObject';

import { isAudioAvailable, loadBinaryFromFile } from 'functions';

import Engine, { calcTimeExFromSMFTempo, calculatePositionFromSeconds, sortNotesAndControls } from 'core/Engine';
import IPlayStream from 'core/IPlayStream';
import NoteObject from 'core/NoteObject';
import Part from 'core/Part';

import Options from 'core/playing/Options';
import PlayerProxy from 'core/playing/PlayerProxy';

import { StatusData } from 'types/RenderMessageData';

interface LoopStatus {
	start: IPositionObject;
	end?: IPositionObject | null | undefined;
	loopCount: number | null;
	loopIndex: number;
}

interface FadeoutStatus {
	progress: boolean;
	/** Fadeout step; division count for decreasement */
	step: number;
	startTimeFromLoop: TimeValue;
	fadeoutTime: TimeValue;
	curStep: number;
	startTime: TimeValue;
	nextTime: TimeValue;
}

interface UserEventData {
	type: string;
	data: any;
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

function convertBkChordsToNotes(bkChords: BackgroundChord[], endPos: IPositionObject): NoteObject[] {
	const arr: NoteObject[] = [];
	if (!bkChords)
		return arr;
	for (let i = 0; i < bkChords.length; ++i) {
		const bc = bkChords[i];
		const posNum = bc.posNumerator;
		const posDen = bc.posDenominator;
		let nextPosNum: number;
		let nextPosDen: number;
		if (i === bkChords.length - 1) {
			nextPosNum = endPos.numerator;
			nextPosDen = endPos.denominator;
		} else {
			nextPosNum = bkChords[i + 1].posNumerator;
			nextPosDen = bkChords[i + 1].posDenominator;
		}
		const noteLengthNum = nextPosNum * posDen - posNum * nextPosDen;
		const noteLengthDen = posDen * nextPosDen;

		let n = new NoteObject(posNum, posDen, noteLengthNum, noteLengthDen, bc.rootNote, Constants.ChannelRootNote);
		arr.push(n);
		for (const note of bc.notes) {
			n = new NoteObject(posNum, posDen, noteLengthNum, noteLengthDen, note, Constants.ChannelChordNote);
			arr.push(n);
		}
	}
	return arr;
}

function makeEventData(object: ISequencerObject): JSSynth.SequencerEvent {
	if (object instanceof AftertouchControl) {
		return {
			type: JSSynth.SequencerEventTypes.EventType.KeyPressure,
			channel: object.channel,
			key: object.noteValue,
			value: object.value
		};
	} else if (object instanceof ControllerControl) {
		return {
			type: JSSynth.SequencerEventTypes.EventType.ControlChange,
			channel: object.channel,
			control: object.value1,
			value: object.value2
		};
	} else if (object instanceof PitchWheelControl) {
		return {
			type: JSSynth.SequencerEventTypes.EventType.PitchBend,
			channel: object.channel,
			value: object.value
		};
	} else if (object instanceof PressureControl) {
		return {
			type: JSSynth.SequencerEventTypes.EventType.ChannelPressure,
			channel: object.channel,
			value: object.value
		};
	} else {
		throw new Error('Not supported');
	}
}

function makeDefaultChannelStatus(): ChannelStatus {
	return {
		volume: Constants.InitialVolume
	};
}

/**
 * Process and render the sequencer objects.
 *
 * After instantiation, initialize() method must be called.
 */
export default class Player {
	public engine: Engine;

	private channels: ChannelStatus[] = [];

	private proxy: PlayerProxy;
	private sfontDefault: number | null = null;
	private isSfontDefaultExternal: boolean = false;
	private sfontMap: SFontMap[] = [];
	private masterVolume: number = Constants.PlayVolume;
	private channel16IsDrums: boolean = false;
	private releasePlayerTimer: number | null = null;
	private outputStream: IPlayStream | null = null;
	private audioWorkletScripts: string[] = [];

	private _isPlayingSequence: boolean = false;

	private _nextPlayTimerId: number | null = null;
	private _availablePlayNote: boolean = false;
	private _playingNotes: NoteObject[] = [];
	private _allPlayedNoteCount: number = 0;
	private _evtPlayQueue: Array<(e: PlayQueueEventObject) => void> = [];
	private _evtPlayStatus: Array<(e: PlayStatusEventObject) => void> = [];
	private _evtPlayEndNote: Array<(e: PlayEndNoteEventObject) => void> = [];
	private _evtPlayAllQueued: Array<(e: PlayQueueEventObject) => void> = [];
	private _evtStopped: Array<(e: SimpleEventObject<Player>) => void> = [];
	private _evtReset: Array<(e: SimpleEventObject<Player>) => void> = [];
	private _evtPlayUserEvent: Array<(e: PlayUserEventObject) => void> = [];

	private playOptions: Options = {};
	private playingNote: NoteObject | null = null;
	private playingStream: IPlayStream | null = null;
	private audio: BaseAudioContext | null = null;
	private audioDest: AudioNode | null = null;
	private playingNode: AudioNode | null = null;
	private playingGain: GainNode | null = null;
	private _isPlayerRunning: boolean = false;
	private isNodeConnected = false;
	private isWorkletLoaded = false;

	private queuedNotesPos: IPositionObject | null = null;
	private queuedNotesTime: TimeValue = 0;
	private queuedNotesBasePos: IPositionObject | null = null;
	private queuedNotesBaseTime: TimeValue = 0;
	/** True if 'enable loop' event has been occurred */
	private loopEnabled: boolean = false;
	private fadeout: FadeoutStatus | null = null;
	private renderedTime: TimeValue = 0;
	private renderedFrames: number = 0;
	private playedTime: TimeValue = 0;
	private playedFrames: number = 0;
	private tempo: number = 500000; // 60000000 / 120
	private isAllNotesPlayed: boolean = false;
	private isWaitingForStop: boolean = false;

	private constructor(engine: Engine, proxy: PlayerProxy) {
		this.engine = engine;
		this.proxy = proxy;
		proxy.onQueued = this.onQueuedPlayer.bind(this);
		proxy.onStatus = this.onStatusPlayer.bind(this);
		proxy.onStop = this.onStopPlayer.bind(this);
		proxy.onReset = this.onResetPlayer.bind(this);
		proxy.onUserData = this.onUserDataPlayer.bind(this);

		// for sequencer
		this.addEventHandler('playuserevent', (e) => this.onPlayUserEvent(e));
	}

	public static isSupported() {
		return typeof AudioContext !== 'undefined' && typeof WebAssembly !== 'undefined';
	}

	public static isAudioWorkletSupported() {
		return typeof AudioWorkletNode !== 'undefined';
	}

	/**
	 * Create the player instance.
	 * @param engine Engine instance to receive sequencer objects
	 * @param workerJs worker script file which includes js-sequencer's worker code
	 * @param depsJs dependency JS files which workerJs (and js-sequencer's worker) uses
	 * @param interval timer interval for worker processing (default: 30)
	 * @param framesCount output frame count per one render process (default: 8192)
	 * @param sampleRate audio sample rate (default: 48000)
	 * @return Promise object which resolves with Player instance when initialization is done
	 */
	public static instantiate(
		engine: Engine,
		workerJs: string,
		depsJs: string[],
		shareWorker?: boolean,
		interval?: number,
		framesCount?: number,
		sampleRate?: number
	): Promise<Player> {
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
			shareWorker, workerJs, depsJs, interval, framesCount, sampleRate, Constants.ChannelChordNote
		).then((p) => new Player(engine, p));
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

	private onQueuedPlayer(s: StatusData) {
		this.renderedFrames += s.outFrames;
		this.renderedTime = this.renderedFrames / s.sampleRate;
		// console.log('onQueuedPlayer:', this.renderedTime, this.renderedFrames);
	}

	private onStatusPlayer(s: StatusData) {
		this.playedFrames += s.outFrames;
		this.playedTime = this.playedFrames / s.sampleRate;
		// console.log('onStatusPlayer:', this.playedTime, this.playedFrames);

		this.raiseEventPlayStatus(this.playedFrames, s.sampleRate);
	}

	private onStopPlayer() {
		if (this._isPlayingSequence) {
			// console.log('onStopPlayer');
			setTimeout(() => this._stopSequenceImpl(), 0);
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
	public addEventHandler<T extends keyof PlayerEventObjectMap>(
		name: T, fn: (e: PlayerEventObjectMap[T]) => void
	): void {
		let arr: any[] | undefined;
		switch (name.toLowerCase()) {
			case 'reset': arr = this._evtReset; break;
			case 'stopped': arr = this._evtStopped; break;
			case 'playqueue': arr = this._evtPlayQueue; break;
			case 'playstatus': arr = this._evtPlayStatus; break;
			case 'playuserevent': arr = this._evtPlayUserEvent; break;
			case 'playendnote': arr = this._evtPlayEndNote; break;
			case 'playallqueued': arr = this._evtPlayAllQueued; break;
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
	public removeEventHandler<T extends keyof PlayerEventObjectMap>(
		name: T, fn: (e: PlayerEventObjectMap[T]) => void
	): void {
		let arr: any[] | undefined;
		switch (name.toLowerCase()) {
			case 'reset': arr = this._evtReset; break;
			case 'stopped': arr = this._evtStopped; break;
			case 'playqueue': arr = this._evtPlayQueue; break;
			case 'playstatus': arr = this._evtPlayStatus; break;
			case 'playuserevent': arr = this._evtPlayUserEvent; break;
			case 'playendnote': arr = this._evtPlayEndNote; break;
			case 'playallqueued': arr = this._evtPlayAllQueued; break;
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

		this.loopEnabled = false;
		this.renderedFrames = 0;
		this.renderedTime = 0;
		this.playedFrames = 0;
		this.playedTime = 0;
		this.isWaitingForStop = false;
		this.isAllNotesPlayed = false;
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

	private doSendEvent(ev: JSSynth.SequencerEvent, time: TimeValue | null | undefined) {
		if (!this.preSendEvent(ev, time)) {
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
	 */
	public startPlayer(actx?: BaseAudioContext | null, dest?: AudioNode | null) {
		if (!isAudioAvailable()) {
			return Promise.reject(new Error('Not supported'));
		}

		this.stopPlayer();
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
		this._isPlayerRunning = false;
		this.proxy.stop();
		if (this.playingNode) {
			this.playingNode.disconnect();
			this.isNodeConnected = false;
		}
		this.setReleaseTimer();
		if (this.isWaitingForStop) {
			this.isWaitingForStop = false;
			this.raiseEventStopped();
		}
	}

	/**
	 * Return whether the player is running (rendering).
	 */
	public isPlayerRunning() {
		return this._isPlayerRunning;
	}

	private setReleaseTimer() {
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

	////////////////////////////////////////////////////////////////////////////

	private raiseEventPlayQueue(current: number, total: number, playing: number, played: number) {
		const e = new PlayQueueEventObject(this, current, total, playing, played);
		for (const fn of this._evtPlayQueue) {
			fn(e);
			if (e.isPropagationStopped())
				break;
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventPlayEndNote(playing: number, played: number) {
		const e = new PlayEndNoteEventObject(this, playing, played);
		for (const fn of this._evtPlayEndNote) {
			fn(e);
			if (e.isPropagationStopped())
				break;
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventPlayAllQueued(total: number, playing: number, played: number) {
		const e = new PlayQueueEventObject(this, total, total, playing, played);
		for (const fn of this._evtPlayAllQueued) {
			fn(e);
			if (e.isPropagationStopped())
				break;
		}
		return !e.isDefaultPrevented();
	}

	public playNote(n: NoteObject, actx?: BaseAudioContext | null, dest?: AudioNode | null) {
		if (!isAudioAvailable()) {
			return;
		}
		this.stopPlayingNote();

		if (dest) {
			actx = dest.context;
		}

		// this.stopPlayer();
		this.prepareAudioContext(actx).then((a) => {
			this.prepareForPlay(a, dest || a.destination);

			this.proxy.sendEventNow({
				type: JSSynth.SequencerEventTypes.EventType.NoteOn,
				channel: n.channel >= 0 ? n.channel : Constants.ChannelSingleNote,
				key: n.noteValue,
				vel: n.velocity
			});

			this.playingNote = n;
		});
	}

	/**
	 * Stop playing the note played by playNote method.
	 * The player data is not released, if doReleasePlayer is not true, or until releasePlayer method is called.
	 */
	public stopPlayingNote(doReleasePlayer?: boolean) {
		const n = this.playingNote;
		if (n) {
			this.proxy.sendEventNow({
				type: JSSynth.SequencerEventTypes.EventType.NoteOff,
				channel: n.channel >= 0 ? n.channel : 0,
				key: n.noteValue
			});
			this.playingNote = null;
		}
		if (doReleasePlayer) {
			this.setReleaseTimer();
		}
	}

	public playNoteMultiple(
		notes: NoteObject | NoteObject[],
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null
	) {
		if (!isAudioAvailable()) {
			return;
		}

		const arr = notes instanceof Array ? notes : [notes];

		if (dest) {
			actx = dest.context;
		}

		// this.stopPlayer();
		this.prepareAudioContext(actx).then((a) => {
			if (!this.isNodeConnected) {
				this.prepareForPlay(a, dest || a.destination);
			}

			arr.forEach((n) => {
				this.proxy.sendEventNow({
					type: JSSynth.SequencerEventTypes.EventType.NoteOn,
					channel: n.channel >= 0 ? n.channel : Constants.ChannelSingleNote,
					key: n.noteValue,
					vel: n.velocity
				});
			});
		});
	}

	public stopNoteMultiple(notes: NoteObject | NoteObject[], doReleasePlayer?: boolean) {
		if (!isAudioAvailable()) {
			return;
		}

		const arr = notes instanceof Array ? notes : [notes];
		arr.forEach((n) => {
			this.proxy.sendEventNow({
				type: JSSynth.SequencerEventTypes.EventType.NoteOff,
				channel: n.channel >= 0 ? n.channel : 0,
				key: n.noteValue
			});
			this.playingNote = null;
		});
		if (doReleasePlayer) {
			this.setReleaseTimer();
		}
	}

	private _checkStopped() {
		if (!this._isPlayingSequence) {
			return;
		}
		if (this._playingNotes && this._playingNotes.length > 0) {
			return;
		}
		if (this._availablePlayNote) {
			return;
		}
		if (this.isWaitingForStop) {
			return;
		}
		if (this.renderedTime < this.queuedNotesTime || this.playedTime < this.renderedTime) {
			// console.log('_checkStopped:', this.playedTime, this.renderedTime);
			return;
		}
		this._isPlayingSequence = false;
		this.isWaitingForStop = true;
		// console.log('Do finish');
		this.proxy.waitForFinish().then(() => {
			// console.log('All finished');
			this.stopPlayer();
		});
	}

	private prepareBasePos(
		notesAndControls: ISequencerObject[],
		from?: Readonly<IPositionObject> | null,
		timeStartOffset?: number | null
	): number {
		this.queuedNotesPos = null;
		this.queuedNotesTime = 0;
		this.queuedNotesBaseTime = timeStartOffset || 0;
		if (!from) {
			this.queuedNotesBasePos = { numerator: 0, denominator: 1 };
			return 0;
		}

		if (!this.queuedNotesBasePos) {
			this.queuedNotesBasePos = { numerator: 0, denominator: 1 };
		}
		if (!this.queuedNotesPos) {
			this.queuedNotesPos = { numerator: 0, denominator: 1 };
		}
		this.queuedNotesTime = 0;
		this.queuedNotesBaseTime = 0;
		const curPos = this.queuedNotesPos;
		let index = 0;
		while (index < notesAndControls.length) {
			const o = notesAndControls[index];
			if (o.notePosNumerator * from.denominator >= from.numerator * o.notePosDenominator) {
				break;
			}
			++index;

			curPos.numerator = o.notePosNumerator;
			curPos.denominator = o.notePosDenominator;

			this.processObject(o, index, notesAndControls.length, curPos, 0, null, true);
		}
		// reset these because the values may be changed in processObject
		this.queuedNotesTime = 0;
		this.queuedNotesBaseTime = 0;

		this.queuedNotesPos = { numerator: from.numerator, denominator: from.denominator };
		this.queuedNotesBasePos = { numerator: from.numerator, denominator: from.denominator };
		return index;
	}

	private prepareLoop(_notesAndControls: ISequencerObject[], _loopStatus: LoopStatus) {
		// enabled at first; disabled on loop
		this.loopEnabled = true;
	}

	private doSetupFadeout(fadeout: FadeoutStatus) {
		if (fadeout.progress) {
			return;
		}
		fadeout.progress = true;
		fadeout.startTime = this.queuedNotesTime + fadeout.startTimeFromLoop;
		fadeout.curStep = 0;
		fadeout.nextTime = fadeout.startTime + fadeout.fadeoutTime / fadeout.step;
	}

	private doProcessFadeout(time: TimeValue) {
		const fadeout = this.fadeout;
		if (fadeout && fadeout.progress) {
			while (fadeout.nextTime <= time) {
				if (!this.doSendFadeoutVolume(fadeout)) {
					return false;
				}
			}
		}
		return true;
	}

	protected preSendEvent(ev: JSSynth.SequencerEvent, time: TimeValue | null | undefined) {
		if (typeof time === 'undefined' || time === null) {
			return true;
		}
		if (!this.doProcessFadeout(time)) {
			return false;
		}
		if (
			ev.type === JSSynth.SequencerEventTypes.EventType.ControlChange &&
			(ev.control === 0x07 || ev.control === 0x27)
		) {
			const fadeout = this.fadeout;
			if (fadeout && fadeout.progress) {
				const channel = ev.channel;
				const ch = this.channels[channel] || (this.channels[channel] = makeDefaultChannelStatus());
				let actualValue: number;
				if (ev.control === 0x07) {
					actualValue = (ch.volume & 0x7F) + (ev.value * 0x80);
				} else {
					actualValue = Math.floor(ch.volume / 0x80) * 0x80 + ev.value;
				}
				const newValue = Math.floor(actualValue * (fadeout.step - fadeout.curStep) / fadeout.step);
				// console.log(`[Player] inject volume for fadeout (actual = ${actualValue}, new = ${newValue})`);
				this.proxy.sendEvent({
					type: JSSynth.SequencerEventTypes.EventType.ControlChange,
					channel: channel,
					control: 0x07,
					value: Math.floor(newValue / 0x80)
				}, time * 1000);
				ev.control = 0x27;
				ev.value = newValue & 0x7F;
			}
		}
		return true;
	}

	private doSendFadeoutVolume(fadeout: FadeoutStatus) {
		if (fadeout.curStep >= fadeout.step) {
			return false;
		}
		++fadeout.curStep;
		const time = fadeout.nextTime;
		const r = (fadeout.step - fadeout.curStep) / fadeout.step;

		fadeout.nextTime = fadeout.startTime + fadeout.fadeoutTime * (fadeout.curStep + 1) / fadeout.step;
		// console.log(`[Player] fadeout: time = ${time}, next = ${fadeout.nextTime}, rate = ${r}`);

		// (including background-chord channel)
		for (let channel = 0; channel < Constants.ChannelChordNote; ++channel) {
			const ch = this.channels[channel];
			const vol = Math.floor((ch ? ch.volume : Constants.InitialVolume) * r);
			this.proxy.sendEvent({
				type: JSSynth.SequencerEventTypes.EventType.ControlChange,
				channel: channel,
				control: 0x07,
				value: Math.floor(vol / 0x80)
			}, time * 1000);
			this.proxy.sendEvent({
				type: JSSynth.SequencerEventTypes.EventType.ControlChange,
				channel: channel,
				control: 0x27,
				value: (vol & 0x7F)
			}, time * 1000);
		}
		return true;
	}

	private doRenderNotes(
		notesAndControls: ISequencerObject[],
		currentIndex: number,
		endTime: IPositionObject | null | undefined,
		loopStatus?: LoopStatus
	) {
		if (!this.queuedNotesBasePos) {
			this.queuedNotesBasePos = { numerator: 0, denominator: 1 };
		}
		if (!this.queuedNotesPos) {
			this.queuedNotesPos = { numerator: 0, denominator: 1 };
		}
		const curPos = this.queuedNotesPos;

		this._nextPlayTimerId = null;

		const maxCount = notesAndControls.length;
		let renderedCount = 0;
		const oldTime = this.queuedNotesTime;

		while (true) {
			if (
				renderedCount >= Constants.MaxEventCountPerRender &&
				this.queuedNotesTime !== oldTime
			) {
				break;
			}
			if (loopStatus) {
				let nextPos: IPositionObject | undefined;
				if (currentIndex < maxCount) {
					const nextObject = notesAndControls[currentIndex];
					nextPos = {
						numerator: nextObject.notePosNumerator,
						denominator: nextObject.notePosDenominator
					};
				}
				if (loopStatus.loopCount === null || this.fadeout || loopStatus.loopIndex < loopStatus.loopCount) {
					if (
						(loopStatus.end && nextPos && nextPos.numerator * loopStatus.end.denominator >= loopStatus.end.numerator * nextPos.denominator) ||
						(currentIndex >= maxCount)
					) {
						// if loop-point reached but not enabled, wait for enabling
						if (!this.loopEnabled) {
							break;
						}
						// --- do loop ---
						const basePos2: IPositionObject = this.queuedNotesBasePos!;
						let timeCurrent: number;
						if (nextPos) {
							// (in this case loopStatus.end is not null)
							timeCurrent = this.queuedNotesBaseTime + calcTimeExFromSMFTempo(
								this.tempo, basePos2.numerator, basePos2.denominator,
								loopStatus.end!.numerator, loopStatus.end!.denominator
							);
							// console.log(`[Player] do loop: next = { ${nextPos.numerator} / ${nextPos.denominator} }, time = ${timeCurrent}`);
						} else {
							timeCurrent = this.queuedNotesTime;
							// console.log(`[Player] do loop: next = (last), time = ${timeCurrent}`);
						}
						// send stop events for all playing notes
						this.noteOffAllPlayingNotes(timeCurrent);
						// re-send events before loop-start position
						currentIndex = this.doLoadAllObjects(notesAndControls, loopStatus.start, timeCurrent);
						// set current position to loop-start position
						// (Note: curPos === this.queuedNotesPos)
						curPos.numerator = loopStatus.start.numerator;
						curPos.denominator = loopStatus.start.denominator;
						this.queuedNotesTime = timeCurrent;  // processPlayingNotes may update queuedNotesTime
						this.queuedNotesBaseTime = timeCurrent;
						this.queuedNotesBasePos = {
							numerator: curPos.numerator,
							denominator: curPos.denominator
						};
						this.loopEnabled = false;
						// increment loop index
						let doSendNextEnableLoop = false;
						if (loopStatus.loopCount !== null) {
							const x = ++loopStatus.loopIndex;
							if (x < loopStatus.loopCount) {
								doSendNextEnableLoop = true;
							} else if (this.fadeout && x > loopStatus.loopCount) {
								// start fadeout (do nothing if already in progress)
								this.doSetupFadeout(this.fadeout);
								// act as infinite loop
								loopStatus.loopCount = null;
								doSendNextEnableLoop = true;
							}
						} else {
							doSendNextEnableLoop = true;
						}
						if (doSendNextEnableLoop) {
							// console.log('[Player] send enable-loop event');
							this.sendUserEvent('enable-loop', this.queuedNotesTime);
						}
					}
				}
			}
			if (currentIndex >= maxCount) {
				if (this._availablePlayNote) {
					this._availablePlayNote = false;
					this.raiseEventPlayAllQueued(maxCount, this._playingNotes.length, this._allPlayedNoteCount);
				}
				if (this.processPlayingNotes()) {
					continue;
				}
				if (!this.isAllNotesPlayed) {
					this.isAllNotesPlayed = true;
					this.sendFinish(this.queuedNotesTime);
				}
				// do finish
				this._checkStopped();
				if (!this._isPlayingSequence) {
					return;
				} else {
					break;
				}
			}
			const o = notesAndControls[currentIndex];

			if (this.processPlayingNotes(o)) {
				continue;
			}

			++currentIndex;

			curPos.numerator = o.notePosNumerator;
			curPos.denominator = o.notePosDenominator;
			const basePos: IPositionObject = this.queuedNotesBasePos!;
			const time = this.queuedNotesTime = this.queuedNotesBaseTime + calcTimeExFromSMFTempo(
				this.tempo, basePos.numerator, basePos.denominator, curPos.numerator, curPos.denominator
			);

			if (!this.processObject(o, currentIndex, maxCount, curPos, time, endTime)) {
				// force finish playing
				this.noteOffAllPlayingNotes(this.queuedNotesTime);
				// disable loop
				loopStatus = void 0;
				// mark position to last
				currentIndex = notesAndControls.length;
				// continue to check finish
				continue;
			}

			++renderedCount;
		}

		// if (renderedCount >= Constants.MaxEventCountPerRender) {
		// 	console.log(`[doRenderNotes] renderedCount is reached to max (${renderedCount})`);
		// }

		// console.log('doRenderNotes: next index =', index,
		// 	', queuedNotesTime =', this.queuedNotesTime,
		// 	', toTime =', toTime);
		this._nextPlayTimerId = setTimeout(
			this.doRenderNotes.bind(this, notesAndControls, currentIndex, endTime, loopStatus),
			5
		);
	}

	private onPlayUserEvent(e: PlayUserEventObject) {
		if (e.type === 'enable-loop') {
			this.loopEnabled = true;
		}
	}

	/** Load all objects and send appropriate MIDI events except for note-on. */
	private doLoadAllObjects(
		notesAndControls: ISequencerObject[],
		stopPosition: IPositionObject,
		currentTime: number
	) {
		if (!this.queuedNotesBasePos) {
			this.queuedNotesBasePos = { numerator: 0, denominator: 1 };
		}
		if (!this.queuedNotesPos) {
			this.queuedNotesPos = { numerator: 0, denominator: 1 };
		}
		const curPos = this.queuedNotesPos;
		this.queuedNotesTime = currentTime;

		let index = 0;
		const len = notesAndControls.length;
		for (; index < len; ++index) {
			const o = notesAndControls[index];
			if (stopPosition.numerator * o.notePosDenominator <= stopPosition.denominator * o.notePosNumerator) {
				break;
			}
			curPos.numerator = o.notePosNumerator;
			curPos.denominator = o.notePosDenominator;
			this.processObject(o, index + 1, notesAndControls.length, curPos, currentTime, null, true);
		}
		return index;
	}

	private processObject(
		o: ISequencerObject,
		index: number,
		totalObjects: number,
		curPos: IPositionObject,
		time: number,
		endTimePos: IPositionObject | null | undefined,
		noSound?: boolean
	): boolean {
		if (o instanceof SysExControl) {
			this.proxy.sendSysEx(o.rawData, time);
			return true;
		} else if (o instanceof TempoControl) {
			// process tempo
			this.queuedNotesBaseTime = this.queuedNotesTime;
			this.queuedNotesBasePos = { numerator: curPos.numerator, denominator: curPos.denominator };
			this.tempo = o.value;
			return true;
		} else if (
			o instanceof KeySignatureControl ||
			o instanceof SysMsgControl ||
			o instanceof TimeSignatureControl
		) {
			// do nothing
			return true;
		} else if (o instanceof ControllerControl) {
			const ch = this.channels[o.channel] || (this.channels[o.channel] = makeDefaultChannelStatus());
			if (o.value1 === 0) { // Bank select MSB
				const val = o.value2 * 0x80;
				if (typeof ch.bank === 'number') {
					ch.bank = (ch.bank & 0x7F) + val;
				} else {
					ch.bank = val;
				}
			} else if (o.value1 === 32) { // Bank select LSB
				const val = o.value2;
				if (typeof ch.bank === 'number') {
					ch.bank = Math.floor(ch.bank / 0x80) * 0x80 + val;
				} else {
					ch.bank = val;
				}
			} else if (o.value1 === 7) { // Volume MSB
				return this.changeVolume(o.channel, true, o.value2, time);
			} else if (o.value1 === 39) { // Volume LSB
				return this.changeVolume(o.channel, false, o.value2, time);
			}
			return this.doSendEvent({
				type: JSSynth.SequencerEventTypes.EventType.ControlChange,
				channel: o.channel,
				control: o.value1,
				value: o.value2
			}, time);
		} else if (o instanceof ProgramChangeControl) {
			return this.doChangeProgram(o.channel, o.value, time);
		} else if (o instanceof NoteObject) {
			if (noSound) {
				return true;
			}
			const cont = this.doSendEvent({
				type: JSSynth.SequencerEventTypes.EventType.NoteOn,
				channel: o.channel,
				key: o.noteValue,
				vel: o.velocity
			}, time);

			++this._allPlayedNoteCount;
			this.raiseEventPlayQueue(index, totalObjects, this._playingNotes.length, this._allPlayedNoteCount);

			const stopPos = new PositionObject(o.noteLengthNumerator, o.noteLengthDenominator);
			stopPos.addPositionMe(curPos);
			if (endTimePos) {
				if (stopPos.numerator * endTimePos.denominator > endTimePos.numerator * stopPos.denominator) {
					stopPos.numerator = endTimePos.numerator;
					stopPos.denominator = endTimePos.denominator;
				}
			}
			o.playEndPosNum = stopPos.numerator;
			o.playEndPosDen = stopPos.denominator;

			// add note to playing list (sorted with 'playEndPosNum / playEndPosDen')
			const len = this._playingNotes.length;
			for (let j = 0; j <= len; ++j) {
				if (j === len) {
					this._playingNotes.push(o);
				} else {
					const n = this._playingNotes[j];
					if (o.playEndPosNum * n.playEndPosDen! < n.playEndPosNum! * o.playEndPosDen) {
						this._playingNotes.splice(j, 0, o);
						break;
					}
				}
			}
			return cont;
		} else {
			try {
				const ev = makeEventData(o);
				return this.doSendEvent(ev, time);
			} catch (_ex) {
				// do nothing for exception
				return true;
			}
		}
	}

	private processPlayingNotes(nextObject?: ISequencerObject) {
		const basePos = this.queuedNotesBasePos!;
		const curPos = this.queuedNotesPos!;
		const n = this._playingNotes[0];
		if (n) {
			if (
				!nextObject ||
				n.playEndPosNum! * nextObject.notePosDenominator <= nextObject.notePosNumerator * n.playEndPosDen!
			) {
				this._playingNotes.shift();
				curPos.numerator = n.playEndPosNum!;
				curPos.denominator = n.playEndPosDen!;
				const time2 = this.queuedNotesTime = this.queuedNotesBaseTime + calcTimeExFromSMFTempo(
					this.tempo, basePos.numerator, basePos.denominator, curPos.numerator, curPos.denominator
				);
				this.proxy.sendEvent({
					type: JSSynth.SequencerEventTypes.EventType.NoteOn,
					channel: n.channel,
					key: n.noteValue,
					vel: 0
				}, time2 * 1000);
				this.raiseEventPlayEndNote(this._playingNotes.length, this._allPlayedNoteCount);
				return true;
			}
		}
		return false;
	}

	private noteOffAllPlayingNotes(timeToOff: TimeValue) {
		let len = this._playingNotes.length;
		this._playingNotes.splice(0).forEach((n) => {
			this.proxy.sendEvent({
				type: JSSynth.SequencerEventTypes.EventType.NoteOn,
				channel: n.channel,
				key: n.noteValue,
				vel: 0
			}, timeToOff * 1000);
			this.raiseEventPlayEndNote(--len, this._allPlayedNoteCount);
		});
	}

	private startPlayData(
		notesAndControls: ISequencerObject[],
		from?: IPositionObject | null,
		to?: IPositionObject | null,
		timeStartOffset?: TimeValue | null,
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null,
		loopData?: LoopData,
		fadeout?: FadeoutData | boolean
	) {
		this.resetChannel();

		if (this._nextPlayTimerId) {
			throw new Error('Unexpected');
		}

		if (dest) {
			actx = dest.context;
		}

		this.prepareAudioContext(actx).then((a) => {
			this.prepareForPlay(a, dest || a.destination);

			this._allPlayedNoteCount = 0;
			this._availablePlayNote = true;
			// this._prepareToPlayNotes(notesAndControls, from, to);
			this._isPlayingSequence = true;

			const startIndex = this.prepareBasePos(notesAndControls, from, timeStartOffset);

			this.channels.forEach((ch, i) => {
				if (ch) {
					if (typeof ch.bank === 'number') {
						this.proxy.sendEvent({
							type: JSSynth.SequencerEventTypes.EventType.ControlChange,
							channel: i,
							control: 0, // Bank MSB
							value: Math.floor(ch.bank / 0x80)
						}, 0);
						if ((ch.bank & 0x7F) !== 0) {
							this.proxy.sendEvent({
								type: JSSynth.SequencerEventTypes.EventType.ControlChange,
								channel: i,
								control: 32, // Bank LSB
								value: (ch.bank & 0x7F)
							}, 0);
						}
					}
					if (typeof ch.preset === 'number') {
						this.doChangeProgram(i, ch.preset, 0);
					}
				}
			});

			const loopCount = loopData && loopData.loopCount;
			let loopStatus: LoopStatus | undefined = loopData && {
				start: loopData.start || { numerator: 0, denominator: 1 },
				end: loopData.end,
				loopCount: typeof loopCount === 'number' ? loopCount : null,
				loopIndex: 0
			};
			const fadeoutData = (typeof fadeout === 'boolean') ?
				(fadeout ? { enabled: true } : void 0) :
				fadeout;
			if (fadeoutData && fadeoutData.enabled) {
				this.fadeout = {
					progress: false,
					step: fadeoutData.step || Constants.DefaultFadeoutStep,
					startTimeFromLoop: typeof fadeoutData.startTimeFromLoop === 'number' ?
						fadeoutData.startTimeFromLoop : Constants.DefaultFadeoutStartTime,
					fadeoutTime: typeof fadeoutData.fadeoutTime === 'number' ?
						fadeoutData.fadeoutTime : Constants.DefaultFadeoutTime,
					curStep: 0,
					startTime: 0,
					nextTime: 0
				};
				if (!loopStatus && fadeoutData) {
					loopStatus = {
						start: { numerator: 0, denominator: 1 },
						loopCount: 0,
						loopIndex: 0
					};
				}
			} else {
				this.fadeout = null;
			}

			if (loopStatus) {
				this.prepareLoop(notesAndControls, loopStatus);
			}

			this.doRenderNotes(notesAndControls, startIndex, to, loopStatus);
		});
	}

	public playPartRange(
		part: Part,
		from?: IPositionObject | null,
		to?: IPositionObject | null,
		backgroundChords?: BackgroundChord[] | null,
		backgroundEndPos?: IPositionObject | null,
		actx?: BaseAudioContext | null
	) {
		if (!isAudioAvailable()) {
			return;
		}
		if (this._isPlayingSequence) {
			this.stopSequence();
		} else {
			let arr = (part.notes as ReadonlyArray<ISequencerObject>).concat(part.controls);
			arr = arr.concat(this.engine.masterControls);
			if (backgroundChords && backgroundEndPos) {
				arr = arr.concat(convertBkChordsToNotes(backgroundChords, backgroundEndPos));
			}
			sortNotesAndControls(arr);
			this.startPlayData(arr, from, to, null, actx);
		}
	}

	public playPart(
		part: Part,
		backgroundChords?: BackgroundChord[] | null,
		backgroundEndPos?: IPositionObject | null,
		actx?: BaseAudioContext | null
	) {
		this.playPartRange(part, null, null, backgroundChords, backgroundEndPos, actx);
	}

	/** Play sequence data from engine instance, with start position and end position, etc. */
	public playSequenceRange(
		from?: IPositionObject | null,
		to?: IPositionObject | null,
		timeStartOffset?: TimeValue | null,
		backgroundChords?: BackgroundChord[] | null,
		backgroundEndPos?: IPositionObject | null,
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null,
		loopData?: LoopData,
		fadeout?: FadeoutData | boolean
	) {
		if (!isAudioAvailable()) {
			return;
		}
		if (this._isPlayingSequence) {
			this.stopSequence();
		} else {
			let arr: ISequencerObject[] = [];
			this.engine.parts.forEach((p) => {
				arr = arr.concat(p.notes);
				arr = arr.concat(p.controls);
			});
			arr = arr.concat(this.engine.masterControls);
			if (backgroundChords && backgroundEndPos) {
				arr = arr.concat(convertBkChordsToNotes(backgroundChords, backgroundEndPos));
			}
			sortNotesAndControls(arr);

			this.startPlayData(arr, from, to, timeStartOffset, actx, dest, loopData, fadeout);
		}
	}

	/** Play sequence data from engine instance. */
	public playSequence(
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null,
		loopData?: LoopData,
		fadeout?: FadeoutData | boolean
	) {
		this.playSequenceRange(null, null, null, null, null, actx, dest, loopData, fadeout);
	}

	public playSequenceTimeRange(
		timeFrom: TimeValue,
		timeTo: TimeValue,
		backgroundChords?: BackgroundChord[] | null,
		backgroundEndPos?: IPositionObject | null,
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null,
		loopData?: LoopData,
		fadeout?: FadeoutData | boolean
	) {
		if (!isAudioAvailable()) {
			return;
		}
		if (this._isPlayingSequence) {
			this.stopSequence();
		} else {
			let arr: ISequencerObject[] = [];
			this.engine.parts.forEach((p) => {
				arr = arr.concat(p.notes);
				arr = arr.concat(p.controls);
			});
			arr = arr.concat(this.engine.masterControls);
			if (backgroundChords && backgroundEndPos) {
				arr = arr.concat(convertBkChordsToNotes(backgroundChords, backgroundEndPos));
			}
			sortNotesAndControls(arr);

			const r = calculatePositionFromSeconds(arr, 60000000 / this.engine.tempo, timeFrom, timeTo, true);
			// if (!__PROD__ && r) {
			// 	console.log("From: " + r.from.numerator + "/" + r.from.denominator);
			// 	console.log("  StartOffset: " + r.timeStartOffset);
			// 	console.log("To: " + r.to.numerator + "/" + r.to.denominator);
			// 	console.log("  Duration: " + r.duration);
			// }

			this.startPlayData(
				arr,
				r && r.from,
				r && r.to,
				(r && r.timeStartOffset) || 0,
				actx,
				dest,
				loopData,
				fadeout
			);
		}
	}

	public isPlaying(): boolean {
		this._checkStopped();
		return this._isPlayingSequence || this.isWaitingForStop;
	}

	private preReleasePlayer() {
		this._stopSequenceImpl(true);
	}

	private _stopSequenceImpl(noWait?: boolean) {
		if (this._isPlayingSequence) {
			this._isPlayingSequence = false;
			this._playingNotes = [];
			this._allPlayedNoteCount = 0;
			this._availablePlayNote = false;
			if (this._nextPlayTimerId !== null) {
				window.clearTimeout(this._nextPlayTimerId);
				this._nextPlayTimerId = null;
			}
			// console.log('Do finish');
			this.proxy.stop();
			if (!noWait) {
				this.isWaitingForStop = true;
				this.proxy.waitForFinish().then(() => {
					// console.log('All finished');
					this.stopPlayer();
				});
			}
		}
	}

	/**
	 * Stop the playing sequence data.
	 * The player data will be released after a few seconds, but
	 * it will be reused when playNote/playSequence* methods are called.
	 */
	public stopSequence(): void {
		this._stopSequenceImpl();
	}

	public resetAll() {
		this.releasePlayer();

		this.engine.reset();
		this.engine.updateMasterControls();
		this.engine.raiseEventFileLoaded();
	}
}
