
import * as JSSynth from 'js-synthesizer';

import { TimeValue } from 'types';

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
import SimpleEventObject from 'events/SimpleEventObject';

import { isAudioAvailable, loadBinaryFromFile } from 'functions';

import Engine, { calcTimeExFromSMFTempo, calculatePositionFromSeconds, sortNotesAndControls } from 'core/Engine';
import IPlayStream from 'core/IPlayStream';
import NoteObject from 'core/NoteObject';
import Part from 'core/Part';

import Options from 'core/playing/Options';
import PlayerProxy from 'core/playing/PlayerProxy';

import { StatusData } from 'types/RenderMessageData';

const enum Constants {
	PlayVolume = 0.5,
	PrerenderTime = 8,
	StopWaitTime = 5,
	DefaultInterval = 30,
	SampleRate = 48000,
	FramesCount = 8192,
	MaxEventCountPerRender = 50,

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
}

declare var WebAssembly: any;

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

	private playOptions: Options = {};
	private playingNote: NoteObject | null = null;
	private playingStream: IPlayStream | null = null;
	private audio: BaseAudioContext | null = null;
	private playingNode: AudioNode | null = null;
	private playingGain: GainNode | null = null;
	private isNodeConnected = false;
	private isWorkletLoaded = false;

	private queuedNotesPos: IPositionObject | null = null;
	private queuedNotesTime: number = 0;
	private queuedNotesBasePos: IPositionObject | null = null;
	private queuedNotesBaseTime: number = 0;
	private renderedTime: number = 0;
	private renderedFrames: number = 0;
	private playedTime: number = 0;
	private playedFrames: number = 0;
	private tempo: number = 500000; // 60000000 / 120
	private isAllNotesPlayed: boolean = false;
	private isWaitingForStop: boolean = false;

	private constructor(engine: Engine, proxy: PlayerProxy) {
		this.engine = engine;
		this.proxy = proxy;
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
		).then((p) => {
			const player = new Player(engine, p);
			p.onQueued = player.onQueuedPlayer.bind(player);
			p.onStatus = player.onStatusPlayer.bind(player);
			p.onStop = player.onStopPlayer.bind(player);
			p.onReset = player.onResetPlayer.bind(player);
			return player;
		});
	}

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

	private raiseEventPlayQueue(current: number, total: number, playing: number, played: number) {
		const e = new PlayQueueEventObject(this, current, total, playing, played);
		for (const fn of this._evtPlayQueue) {
			fn(e);
			if (e.isPropagationStopped())
				break;
		}
		return !e.isDefaultPrevented();
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
		let arr: any[] | null = null;
		switch (name.toLowerCase()) {
			case 'reset': arr = this._evtReset; break;
			case 'stopped': arr = this._evtStopped; break;
			case 'playqueue': arr = this._evtPlayQueue; break;
			case 'playstatus': arr = this._evtPlayStatus; break;
			case 'playendnote': arr = this._evtPlayEndNote; break;
			case 'playallqueued': arr = this._evtPlayAllQueued; break;
		}
		if (!arr) return;
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

	private prepareForPlay(actx: BaseAudioContext) {
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
				gain.connect(actx.destination);
				gain.gain.value = this.masterVolume;
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

		this.renderedFrames = 0;
		this.renderedTime = 0;
		this.playedFrames = 0;
		this.playedTime = 0;
		this.isWaitingForStop = false;
		this.isAllNotesPlayed = false;
	}

	public playNote(n: NoteObject, actx?: BaseAudioContext) {
		if (!isAudioAvailable()) {
			return;
		}
		this.stopPlayingNote();

		// this.stopPlayer();
		this.prepareAudioContext(actx).then((a) => {
			this.prepareForPlay(a);

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

	public playNoteMultiple(notes: NoteObject | NoteObject[], actx?: BaseAudioContext) {
		if (!isAudioAvailable()) {
			return;
		}

		const arr = notes instanceof Array ? notes : [notes];

		// this.stopPlayer();
		this.prepareAudioContext(actx).then((a) => {
			if (!this.isNodeConnected) {
				this.prepareForPlay(a);
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

	public changeProgram(channel: number, preset: number, bank?: number) {
		this.doChangeProgram(channel, preset, null, bank);
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

		const curPos: IPositionObject = { numerator: 0, denominator: 1 };
		let index = 0;
		const basePos: IPositionObject = { numerator: 0, denominator: 1 };
		let btime = 0;
		while (index < notesAndControls.length) {
			const o = notesAndControls[index];
			if (o.notePosNumerator * from.denominator >= from.numerator * o.notePosDenominator) {
				break;
			}
			++index;

			curPos.numerator = o.notePosNumerator;
			curPos.denominator = o.notePosDenominator;
			const curTime = btime + calcTimeExFromSMFTempo(
				this.tempo, basePos.numerator, basePos.denominator, curPos.numerator, curPos.denominator
			);

			if (o instanceof TempoControl) {
				btime = curTime;
				this.queuedNotesBasePos = { numerator: curPos.numerator, denominator: curPos.denominator };
				this.tempo = o.value;
			} else if (o instanceof NoteObject) {
				++this._allPlayedNoteCount;
			} else if (o instanceof ControllerControl) {
				if (o.value1 === 0) { // Bank select MSB
					const ch = this.channels[o.channel] || (this.channels[o.channel] = {});
					const val = o.value2 * 0x80;
					if (typeof ch.bank === 'number') {
						ch.bank = (ch.bank & 0x7F) + val;
					} else {
						ch.bank = val;
					}
				} else if (o.value1 === 32) { // Bank select LSB
					const ch = this.channels[o.channel] || (this.channels[o.channel] = {});
					const val = o.value2;
					if (typeof ch.bank === 'number') {
						ch.bank = Math.floor(ch.bank / 0x80) * 0x80 + val;
					} else {
						ch.bank = val;
					}
				}
			} else if (o instanceof ProgramChangeControl) {
				const ch = this.channels[o.channel] || (this.channels[o.channel] = {});
				ch.preset = o.value;
			}
		}
		this.queuedNotesBasePos = { numerator: from.numerator, denominator: from.denominator };
		return index;
	}

	private doChangeProgram(channel: number, preset: number, timeMilliseconds: number | null, bank?: number) {
		const ch = this.channels[channel] || (this.channels[channel] = {});
		ch.preset = preset;
		if (typeof bank !== 'undefined') {
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
				sfontId: this.sfontDefault!,
				bank: bankCurrent,
				preset: preset
			};
		}
		if (timeMilliseconds === null) {
			this.proxy.sendEventNow(ev);
		} else {
			this.proxy.sendEvent(ev, timeMilliseconds);
		}
	}

	private doRenderNotes(
		notesAndControls: ISequencerObject[],
		currentIndex: number,
		endTime: IPositionObject | null | undefined
	) {
		let index = currentIndex;
		let basePos: IPositionObject = this.queuedNotesBasePos ||
			(this.queuedNotesBasePos = { numerator: 0, denominator: 1 });
		const curPos: IPositionObject = this.queuedNotesPos || (this.queuedNotesPos = { numerator: 0, denominator: 1 });

		this._nextPlayTimerId = null;

		let timeChanged = false;
		let renderedCount = 0;

		while (true) {
			if (
				renderedCount >= Constants.MaxEventCountPerRender &&
				timeChanged
			) {
				break;
			}
			if (index >= notesAndControls.length) {
				if (this._availablePlayNote) {
					this._availablePlayNote = false;
					this.raiseEventPlayAllQueued(notesAndControls.length, this._playingNotes.length, this._allPlayedNoteCount);
				}
				if (this.processPlayingNotes()) {
					continue;
				}
				if (!this.isAllNotesPlayed) {
					this.isAllNotesPlayed = true;
					this.proxy.sendFinishMarker(this.queuedNotesTime * 1000);
				}
				// do finish
				this._checkStopped();
				if (!this._isPlayingSequence) {
					return;
				} else {
					break;
				}
			}
			const o = notesAndControls[index];

			if (this.processPlayingNotes(o)) {
				continue;
			}

			++index;

			curPos.numerator = o.notePosNumerator;
			curPos.denominator = o.notePosDenominator;
			const oldTime = this.queuedNotesTime;
			const time = this.queuedNotesTime = this.queuedNotesBaseTime + calcTimeExFromSMFTempo(
				this.tempo, basePos.numerator, basePos.denominator, curPos.numerator, curPos.denominator
			);
			timeChanged = time !== oldTime;

			if (o instanceof SysExControl) {
				this.proxy.sendSysEx(o.rawData, time);
			} else if (o instanceof TempoControl) {
				// process tempo
				this.queuedNotesBaseTime = this.queuedNotesTime;
				this.queuedNotesBasePos = basePos = { numerator: curPos.numerator, denominator: curPos.denominator };
				this.tempo = o.value;
			} else if (
				o instanceof KeySignatureControl ||
				o instanceof SysMsgControl ||
				o instanceof TimeSignatureControl
			) {
				// do nothing
			} else if (o instanceof ControllerControl) {
				if (o.value1 === 0) { // Bank select MSB
					const ch = this.channels[o.channel] || (this.channels[o.channel] = {});
					const val = o.value2 * 0x80;
					if (typeof ch.bank === 'number') {
						ch.bank = (ch.bank & 0x7F) + val;
					} else {
						ch.bank = val;
					}
				} else if (o.value1 === 32) { // Bank select LSB
					const ch = this.channels[o.channel] || (this.channels[o.channel] = {});
					const val = o.value2;
					if (typeof ch.bank === 'number') {
						ch.bank = Math.floor(ch.bank / 0x80) * 0x80 + val;
					} else {
						ch.bank = val;
					}
				}
				this.proxy.sendEvent({
					type: JSSynth.SequencerEventTypes.EventType.ControlChange,
					channel: o.channel,
					control: o.value1,
					value: o.value2
				}, time * 1000);
			} else if (o instanceof ProgramChangeControl) {
				this.doChangeProgram(o.channel, o.value, time * 1000);
			} else if (o instanceof NoteObject) {
				this.proxy.sendEvent({
					type: JSSynth.SequencerEventTypes.EventType.NoteOn,
					channel: o.channel,
					key: o.noteValue,
					vel: o.velocity
				}, time * 1000);

				++this._allPlayedNoteCount;
				this.raiseEventPlayQueue(index, notesAndControls.length, this._playingNotes.length, this._allPlayedNoteCount);

				const stopPos = new PositionObject(o.noteLengthNumerator, o.noteLengthDenominator);
				stopPos.addPositionMe(curPos);
				if (endTime) {
					if (stopPos.numerator * endTime.denominator > endTime.numerator * stopPos.denominator) {
						stopPos.numerator = endTime.numerator;
						stopPos.denominator = endTime.denominator;
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
			} else {
				try {
					const ev = makeEventData(o);
					this.proxy.sendEvent(ev, time * 1000);
				} catch (_ex) {
					// do nothing for exception
				}
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
			this.doRenderNotes.bind(this, notesAndControls, index, endTime),
			5
		);
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

	private startPlayData(
		notesAndControls: ISequencerObject[],
		from?: IPositionObject | null,
		to?: IPositionObject | null,
		timeStartOffset?: TimeValue | null,
		actx?: BaseAudioContext | null
	) {
		this.resetChannel();

		if (this._nextPlayTimerId) {
			throw new Error('Unexpected');
		}

		this.prepareAudioContext(actx).then((a) => {
			this.prepareForPlay(a);

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

			this.doRenderNotes(notesAndControls, startIndex, to);
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
			let arr = (part.notes as ISequencerObject[]).concat(part.controls);
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

	public playSequenceRange(
		from?: IPositionObject | null,
		to?: IPositionObject | null,
		timeStartOffset?: TimeValue | null,
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

			this.startPlayData(arr, from, to, timeStartOffset, actx);
		}
	}

	public playSequence(actx?: BaseAudioContext | null) {
		this.playSequenceRange(null, null, void 0, void 0, void 0, actx);
	}

	public playSequenceTimeRange(
		timeFrom: TimeValue,
		timeTo: TimeValue,
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

			this.startPlayData(arr, r && r.from, r && r.to, (r && r.timeStartOffset) || 0, actx);
		}
	}

	public isPlaying(): boolean {
		this._checkStopped();
		return this._isPlayingSequence || this.isWaitingForStop;
	}

	public startPlayer(actx?: BaseAudioContext | null) {
		if (!isAudioAvailable()) {
			return Promise.reject(new Error('Not supported'));
		}
		this.stopPlayingNote();

		this.stopPlayer();
		return this.prepareAudioContext(actx).then((a) => this.prepareForPlay(a));
	}

	private stopPlayer() {
		if (this.releasePlayerTimer) {
			return;
		}
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

	private setReleaseTimer() {
		this.releasePlayerTimer = setTimeout(
			this.releasePlayerCallback.bind(this),
			Constants.StopWaitTime * 1000
		);
	}

	public releasePlayer(resetSynth?: boolean) {
		this._stopSequenceImpl(true);
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
		if (this.audio) {
			this.audio = null;
			this.isWorkletLoaded = false;
		}
		if (this.isWaitingForStop) {
			this.isWaitingForStop = false;
			this.raiseEventStopped();
		}
	}

	private releasePlayerCallback() {
		this.releasePlayerTimer = null;
		this.releasePlayer();
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

	public getMasterVolume() {
		return this.masterVolume;
	}

	public setMasterVolume(value: number) {
		this.masterVolume = value;
		if (this.playingGain) {
			this.playingGain.gain.value = value;
		}
	}

	public isChannel16IsDrums() {
		return this.channel16IsDrums;
	}

	public setChannel16IsDrums(value: boolean) {
		if (this._isPlayingSequence) {
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

	public setRenderFrameCount(count: number) {
		return this.proxy.configure({
			framesCount: count
		});
	}

	public setSynthGain(value: number) {
		return this.proxy.configure({
			gain: value
		});
	}

	public setOutputStream(stream: IPlayStream | null) {
		this.outputStream = stream;
	}
}
