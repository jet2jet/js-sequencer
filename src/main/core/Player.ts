import * as JSSynth from 'js-synthesizer';

import PlayerBase, { StatusData } from './PlayerBase';

import { FadeoutData, LoopData, TimeValue, TimeRationalValue } from '../types';

import BackgroundChord from '../objects/BackgroundChord';
import IPositionObject from '../objects/IPositionObject';
import ISequencerObject from '../objects/ISequencerObject';
import PositionObject from '../objects/PositionObject';

import AftertouchControl from './controls/AftertouchControl';
import ControllerControl from './controls/ControllerControl';
import KeySignatureControl from './controls/KeySignatureControl';
import PitchWheelControl from './controls/PitchWheelControl';
import PressureControl from './controls/PressureControl';
import ProgramChangeControl from './controls/ProgramChangeControl';
import SysExControl from './controls/SysExControl';
import SysMsgControl from './controls/SysMsgControl';
import TempoControl from './controls/TempoControl';
import TimeSignatureControl from './controls/TimeSignatureControl';

import PlayEndNoteEventObject from '../events/PlayEndNoteEventObject';
import PlayerBaseEventObjectMap from '../events/PlayerBaseEventObjectMap';
import PlayerEventObjectMap from '../events/PlayerEventObjectMap';
import PlayLoopedEventObject from '../events/PlayLoopedEventObject';
import PlayQueueEventObject from '../events/PlayQueueEventObject';
import PlayStatusEventObject from '../events/PlayStatusEventObject';
import PlayUserEventObject from '../events/PlayUserEventObject';
import PlayUserMarkerEventObject from '../events/PlayUserMarkerEventObject';

import { isAudioAvailable } from '../functions';
import * as TimeRational from '../functions/timeRational';

import Engine, {
	calcTimeExFromSMFTempo,
	calculatePositionFromSeconds,
	calculateSecondsFromPosition2,
	sortNotesAndControls,
	calculatePositionFromSeconds2,
} from './Engine';
import NoteObject from './NoteObject';
import Part from './Part';

import PlayerProxy from './playing/PlayerProxy';

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

interface ChannelStatus {
	bank?: number;
	preset?: number;
	volume: number;
}

// eslint-disable-next-line no-var
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

	InitialVolume = 12800, // 100 * 0x80

	ChannelCount = 32,

	ChannelSingleNote = 16,
	ChannelRootNote = 17,
	ChannelChordNote = 18,
}

function convertBkChordsToNotes(
	bkChords: BackgroundChord[],
	endPos: IPositionObject
): NoteObject[] {
	const arr: NoteObject[] = [];
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

		let n = new NoteObject(
			posNum,
			posDen,
			noteLengthNum,
			noteLengthDen,
			bc.rootNote,
			Constants.ChannelRootNote
		);
		arr.push(n);
		for (const note of bc.notes) {
			n = new NoteObject(
				posNum,
				posDen,
				noteLengthNum,
				noteLengthDen,
				note,
				Constants.ChannelChordNote
			);
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
			value: object.value,
		};
	} else if (object instanceof ControllerControl) {
		return {
			type: JSSynth.SequencerEventTypes.EventType.ControlChange,
			channel: object.channel,
			control: object.value1,
			value: object.value2,
		};
	} else if (object instanceof PitchWheelControl) {
		return {
			type: JSSynth.SequencerEventTypes.EventType.PitchBend,
			channel: object.channel,
			value: object.value,
		};
	} else if (object instanceof PressureControl) {
		return {
			type: JSSynth.SequencerEventTypes.EventType.ChannelPressure,
			channel: object.channel,
			value: object.value,
		};
	} else {
		throw new Error('Not supported');
	}
}

function makeDefaultChannelStatus(): ChannelStatus {
	return {
		volume: Constants.InitialVolume,
	};
}

/**
 * Process and render the sequencer objects.
 *
 * The instance must be created with Player.instantiate.
 */
export default class Player extends PlayerBase {
	public engine: Engine;

	private _isPlayingSequence: boolean = false;

	private _nextPlayTimerId: number | null = null;
	private _availablePlayNote: boolean = false;
	private _playingNotes: NoteObject[] = [];
	private _allPlayedNoteCount: number = 0;
	private readonly _evtPlayQueue: Array<(e: PlayQueueEventObject) => void> =
		[];
	private readonly _evtPlayEndNote: Array<
		(e: PlayEndNoteEventObject) => void
	> = [];
	private readonly _evtPlayAllQueued: Array<
		(e: PlayQueueEventObject) => void
	> = [];
	private readonly _evtPlayLooped: Array<(e: PlayLoopedEventObject) => void> =
		[];

	private playingNote: NoteObject | null = null;

	private queuedNotesPos: IPositionObject | null = null;
	private queuedNotesTime: TimeValue = 0;
	private queuedNotesBasePos: IPositionObject | null = null;
	private queuedNotesBaseTime: TimeValue = 0;
	/** True if 'enable loop' event has been occurred */
	private loopEnabled: boolean = false;
	private loopDuration: TimeRationalValue | null = null;
	private loopIndexCurrent: number = 0;
	private fadeout: FadeoutStatus | null = null;
	private renderedTime: TimeValue = 0;
	private renderedFrames: number = 0;
	private playedTime: TimeValue = 0;
	private tempo: number = 500000; // 60000000 / 120
	private isAllNotesPlayed: boolean = false;

	private constructor(engine: Engine, proxy: PlayerProxy) {
		super(proxy);

		this.engine = engine;

		this.addEventHandler('playuserevent', (e) => this.onPlayUserEvent(e));
		this.addEventHandler('playstatus', (e) => this.onPlayStatusEvent(e));
		this.addEventHandler('playusermarkerevent', (e) =>
			this.onPlayUserMarkerEvent(e)
		);
	}

	public static isSupported() {
		return (
			typeof AudioContext !== 'undefined' &&
			typeof WebAssembly !== 'undefined'
		);
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
		return PlayerBase.instantiateProxy(
			workerJs,
			depsJs,
			shareWorker,
			interval,
			framesCount,
			sampleRate,
			Constants.ChannelChordNote
		).then((p) => new Player(engine, p));
	}

	protected onQueuedPlayer(s: StatusData) {
		super.onQueuedPlayer(s);
		this.renderedFrames += s.outFrames;
		this.renderedTime = this.renderedFrames / s.sampleRate;
		// console.log('onQueuedPlayer:', this.renderedTime, this.renderedFrames);
	}

	/**
	 * Add the event handler for the player.
	 * @param name event name
	 * @param fn event handler
	 */
	public addEventHandler<T extends keyof PlayerEventObjectMap>(
		name: T,
		fn: (e: PlayerEventObjectMap[T]) => void
	): void {
		let arr: any[];
		switch (name.toLowerCase()) {
			case 'playqueue':
				arr = this._evtPlayQueue;
				break;
			case 'playendnote':
				arr = this._evtPlayEndNote;
				break;
			case 'playallqueued':
				arr = this._evtPlayAllQueued;
				break;
			case 'playlooped':
				arr = this._evtPlayLooped;
				break;
			default:
				return super.addEventHandler(
					name as keyof PlayerBaseEventObjectMap,
					fn as (
						e: PlayerBaseEventObjectMap[keyof PlayerBaseEventObjectMap]
					) => void
				);
		}
		arr.push(fn);
	}
	/**
	 * Remove the event handler from the player.
	 * @param name event name
	 * @param fn registered event handler
	 */
	public removeEventHandler<T extends keyof PlayerEventObjectMap>(
		name: T,
		fn: (e: PlayerEventObjectMap[T]) => void
	): void {
		let arr: any[];
		switch (name.toLowerCase()) {
			case 'playqueue':
				arr = this._evtPlayQueue;
				break;
			case 'playendnote':
				arr = this._evtPlayEndNote;
				break;
			case 'playallqueued':
				arr = this._evtPlayAllQueued;
				break;
			case 'playlooped':
				arr = this._evtPlayLooped;
				break;
			default:
				return super.removeEventHandler(
					name as keyof PlayerBaseEventObjectMap,
					fn as (
						e: PlayerBaseEventObjectMap[keyof PlayerBaseEventObjectMap]
					) => void
				);
		}
		for (let i = arr.length - 1; i >= 0; --i) {
			if (arr[i] === fn) {
				arr.splice(i, 1);
				break;
			}
		}
	}

	private raiseEventPlayQueue(
		current: number,
		total: number,
		playing: number,
		played: number
	) {
		const e = new PlayQueueEventObject(
			this,
			current,
			total,
			playing,
			played
		);
		for (const fn of this._evtPlayQueue) {
			fn(e);
			if (e.isPropagationStopped()) break;
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventPlayEndNote(playing: number, played: number) {
		const e = new PlayEndNoteEventObject(this, playing, played);
		for (const fn of this._evtPlayEndNote) {
			fn(e);
			if (e.isPropagationStopped()) break;
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventPlayAllQueued(
		total: number,
		playing: number,
		played: number
	) {
		const e = new PlayQueueEventObject(this, total, total, playing, played);
		for (const fn of this._evtPlayAllQueued) {
			fn(e);
			if (e.isPropagationStopped()) break;
		}
		return !e.isDefaultPrevented();
	}
	private raiseEventPlayLooped(
		loopStatus: LoopStatus,
		currentFrame: number,
		sampleRate: number
	) {
		const e = new PlayLoopedEventObject(
			this,
			loopStatus.start,
			loopStatus.end || null,
			loopStatus.loopIndex,
			currentFrame,
			sampleRate
		);
		for (const fn of this._evtPlayLooped) {
			fn(e);
			if (e.isPropagationStopped()) break;
		}
		return !e.isDefaultPrevented();
	}

	public playNote(
		n: NoteObject,
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null
	) {
		if (!isAudioAvailable()) {
			return;
		}
		this.stopPlayingNote();

		const doPlay = () => {
			this.sendEvent({
				type: JSSynth.SequencerEventTypes.EventType.NoteOn,
				channel:
					n.channel >= 0 ? n.channel : Constants.ChannelSingleNote,
				key: n.noteValue,
				vel: n.velocity,
			});

			this.playingNote = n;
		};
		if (this.isPlayerRunning()) {
			doPlay();
		} else {
			// this.stopPlayer();
			void this.startPlayer(actx, dest).then(doPlay);
		}
	}

	/**
	 * Stop playing the note played by playNote method.
	 * The player data is not released, if doReleasePlayer is not true, or until releasePlayer method is called.
	 */
	public stopPlayingNote(doReleasePlayer?: boolean) {
		const n = this.playingNote;
		if (n) {
			this.sendEvent({
				type: JSSynth.SequencerEventTypes.EventType.NoteOff,
				channel: n.channel >= 0 ? n.channel : 0,
				key: n.noteValue,
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

		const doPlay = () => {
			arr.forEach((n) => {
				this.sendEvent({
					type: JSSynth.SequencerEventTypes.EventType.NoteOn,
					channel:
						n.channel >= 0
							? n.channel
							: Constants.ChannelSingleNote,
					key: n.noteValue,
					vel: n.velocity,
				});
			});
		};
		if (this.isPlayerRunning()) {
			doPlay();
		} else {
			// this.stopPlayer();
			void this.startPlayer(actx, dest, true).then(doPlay);
		}
	}

	public stopNoteMultiple(
		notes: NoteObject | NoteObject[],
		doReleasePlayer?: boolean
	) {
		if (!isAudioAvailable()) {
			return;
		}

		const arr = notes instanceof Array ? notes : [notes];
		arr.forEach((n) => {
			this.sendEvent({
				type: JSSynth.SequencerEventTypes.EventType.NoteOff,
				channel: n.channel >= 0 ? n.channel : 0,
				key: n.noteValue,
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
		if (this._playingNotes.length > 0) {
			return;
		}
		if (this._availablePlayNote) {
			return;
		}
		if (
			this.renderedTime < this.queuedNotesTime ||
			this.playedTime < this.renderedTime
		) {
			// console.log('_checkStopped:', this.playedTime, this.renderedTime);
			return;
		}
		this._isPlayingSequence = false;
	}

	protected onPlayStart() {
		this.loopEnabled = false;
		this.isAllNotesPlayed = false;
		this.renderedFrames = 0;
		this.renderedTime = 0;
		this.playedTime = 0;
	}

	private prepareBasePos(
		notesAndControls: ISequencerObject[],
		from?: Readonly<IPositionObject> | null,
		timeStartOffset?: number | null
	): number {
		this.queuedNotesPos = null;
		this.queuedNotesTime = 0;
		this.queuedNotesBaseTime = timeStartOffset ?? 0;
		if (!from) {
			this.queuedNotesBasePos = { numerator: 0, denominator: 1 };
			return 0;
		}

		if (!this.queuedNotesBasePos) {
			this.queuedNotesBasePos = { numerator: 0, denominator: 1 };
		}
		this.queuedNotesPos = { numerator: 0, denominator: 1 };
		this.queuedNotesTime = 0;
		this.queuedNotesBaseTime = 0;
		const curPos = this.queuedNotesPos;
		let index = 0;
		while (index < notesAndControls.length) {
			const o = notesAndControls[index];
			if (
				o.notePosNumerator * from.denominator >=
				from.numerator * o.notePosDenominator
			) {
				break;
			}
			++index;

			curPos.numerator = o.notePosNumerator;
			curPos.denominator = o.notePosDenominator;

			this.processObject(
				o,
				index,
				notesAndControls.length,
				curPos,
				0,
				null,
				true
			);
		}
		// reset these because the values may be changed in processObject
		this.queuedNotesTime = 0;
		this.queuedNotesBaseTime = 0;

		this.queuedNotesPos = {
			numerator: from.numerator,
			denominator: from.denominator,
		};
		this.queuedNotesBasePos = {
			numerator: from.numerator,
			denominator: from.denominator,
		};
		return index;
	}

	private prepareLoop(
		notesAndControls: ISequencerObject[],
		loopStatus: LoopStatus
	) {
		const r = calculateSecondsFromPosition2(
			notesAndControls,
			60000000 / this.engine.tempo,
			loopStatus.start,
			loopStatus.end || null,
			true
		)!;
		if (r === null) {
			return;
		}

		// enabled at first; disabled on loop
		this.loopEnabled = true;
		this.loopIndexCurrent = 0;
		this.loopDuration = TimeRational.sub(r.timeTo, r.timeFrom);
	}

	private doSetupFadeout(fadeout: FadeoutStatus) {
		if (fadeout.progress) {
			return;
		}
		fadeout.progress = true;
		fadeout.startTime = this.queuedNotesTime + fadeout.startTimeFromLoop;
		fadeout.curStep = 0;
		fadeout.nextTime =
			fadeout.startTime + fadeout.fadeoutTime / fadeout.step;
	}

	private doProcessFadeout(time: TimeValue) {
		const fadeout = this.fadeout;
		if (fadeout?.progress) {
			while (fadeout.nextTime <= time) {
				if (!this.doSendFadeoutVolume(fadeout)) {
					return false;
				}
			}
		}
		return true;
	}

	protected preSendEvent(
		ev: JSSynth.SequencerEvent,
		time: TimeValue | null | undefined
	) {
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
			if (fadeout?.progress) {
				const channel = ev.channel;
				const ch =
					this.channels[channel] ||
					(this.channels[channel] = makeDefaultChannelStatus());
				let actualValue: number;
				if (ev.control === 0x07) {
					actualValue = (ch.volume & 0x7f) + ev.value * 0x80;
				} else {
					actualValue =
						Math.floor(ch.volume / 0x80) * 0x80 + ev.value;
				}
				const newValue = Math.floor(
					(actualValue * (fadeout.step - fadeout.curStep)) /
						fadeout.step
				);
				// console.log(`[Player] inject volume for fadeout (actual = ${actualValue}, new = ${newValue})`);
				this.doSendEvent(
					{
						type:
							JSSynth.SequencerEventTypes.EventType.ControlChange,
						channel: channel,
						control: 0x07,
						value: Math.floor(newValue / 0x80),
					},
					time,
					true
				);
				ev.control = 0x27;
				ev.value = newValue & 0x7f;
			}
		}
		return true;
	}

	protected preSendSysEx(_data: any, time: TimeValue | null | undefined) {
		if (typeof time === 'undefined' || time === null) {
			return true;
		}
		return this.doProcessFadeout(time);
	}

	private doSendFadeoutVolume(fadeout: FadeoutStatus) {
		if (fadeout.curStep >= fadeout.step) {
			return false;
		}
		++fadeout.curStep;
		const time = fadeout.nextTime;
		const r = (fadeout.step - fadeout.curStep) / fadeout.step;

		fadeout.nextTime =
			fadeout.startTime +
			(fadeout.fadeoutTime * (fadeout.curStep + 1)) / fadeout.step;
		// console.log(`[Player] fadeout: time = ${time}, next = ${fadeout.nextTime}, rate = ${r}`);

		// (including background-chord channel)
		for (let channel = 0; channel < Constants.ChannelChordNote; ++channel) {
			const ch = this.channels[channel];
			const vol = Math.floor(
				(ch ? ch.volume : Constants.InitialVolume) * r
			);
			this.doSendEvent(
				{
					type: JSSynth.SequencerEventTypes.EventType.ControlChange,
					channel: channel,
					control: 0x07,
					value: Math.floor(vol / 0x80),
				},
				time,
				true
			);
			this.doSendEvent(
				{
					type: JSSynth.SequencerEventTypes.EventType.ControlChange,
					channel: channel,
					control: 0x27,
					value: vol & 0x7f,
				},
				time,
				true
			);
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
						denominator: nextObject.notePosDenominator,
					};
				}
				if (
					loopStatus.loopCount === null ||
					this.fadeout ||
					loopStatus.loopIndex < loopStatus.loopCount
				) {
					if (
						(loopStatus.end &&
							nextPos &&
							nextPos.numerator * loopStatus.end.denominator >=
								loopStatus.end.numerator *
									nextPos.denominator) ||
						currentIndex >= maxCount
					) {
						// if loop-point reached but not enabled, wait for enabling
						if (!this.loopEnabled) {
							break;
						}
						// --- do loop ---
						const basePos2: IPositionObject =
							this.queuedNotesBasePos;
						let timeCurrent: number;
						if (nextPos) {
							// (in this case loopStatus.end is not null)
							timeCurrent =
								this.queuedNotesBaseTime +
								calcTimeExFromSMFTempo(
									this.tempo,
									basePos2.numerator,
									basePos2.denominator,
									loopStatus.end!.numerator,
									loopStatus.end!.denominator
								);
							// console.log(`[Player] do loop: next = { ${nextPos.numerator} / ${nextPos.denominator} }, time = ${timeCurrent}`);
						} else {
							timeCurrent = this.queuedNotesTime;
							// console.log(`[Player] do loop: next = (last), time = ${timeCurrent}`);
						}
						// send stop events for all playing notes
						this.noteOffAllPlayingNotes(timeCurrent);
						// re-send events before loop-start position
						currentIndex = this.doLoadAllObjects(
							notesAndControls,
							loopStatus.start,
							timeCurrent
						);
						// set current position to loop-start position
						// (Note: curPos === this.queuedNotesPos)
						curPos.numerator = loopStatus.start.numerator;
						curPos.denominator = loopStatus.start.denominator;
						this.queuedNotesTime = timeCurrent; // processPlayingNotes may update queuedNotesTime
						this.queuedNotesBaseTime = timeCurrent;
						this.queuedNotesBasePos = {
							numerator: curPos.numerator,
							denominator: curPos.denominator,
						};
						this.loopEnabled = false;
						// increment loop index
						let doSendNextEnableLoop = false;
						if (loopStatus.loopCount !== null) {
							const x = ++loopStatus.loopIndex;
							if (x < loopStatus.loopCount) {
								doSendNextEnableLoop = true;
							} else if (this.fadeout) {
								if (x > loopStatus.loopCount) {
									// start fadeout (do nothing if already in progress)
									this.doSetupFadeout(this.fadeout);
									// act as infinite loop
									loopStatus.loopCount = null;
								}
								doSendNextEnableLoop = true;
							}
						} else {
							doSendNextEnableLoop = true;
						}
						if (doSendNextEnableLoop) {
							// console.log('[Player] send enable-loop event');
							this.sendUserEvent(
								'enable-loop',
								this.queuedNotesTime
							);
						}
						this.sendUserMarker(
							'looped:' + JSON.stringify(loopStatus),
							this.queuedNotesTime
						);
					}
				}
			}
			if (currentIndex >= maxCount) {
				if (this._availablePlayNote) {
					this._availablePlayNote = false;
					this.raiseEventPlayAllQueued(
						maxCount,
						this._playingNotes.length,
						this._allPlayedNoteCount
					);
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
			const basePos: IPositionObject = this.queuedNotesBasePos;
			const time = (this.queuedNotesTime =
				this.queuedNotesBaseTime +
				calcTimeExFromSMFTempo(
					this.tempo,
					basePos.numerator,
					basePos.denominator,
					curPos.numerator,
					curPos.denominator
				));

			if (
				!this.processObject(
					o,
					currentIndex,
					maxCount,
					curPos,
					time,
					endTime
				)
			) {
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

		this._nextPlayTimerId = setTimeout(
			this.doRenderNotes.bind(
				this,
				notesAndControls,
				currentIndex,
				endTime,
				loopStatus
			),
			5
		);
	}

	private onPlayUserEvent(e: PlayUserEventObject) {
		if (e.type === 'enable-loop') {
			this.loopEnabled = true;
		}
	}

	private onPlayStatusEvent(e: PlayStatusEventObject) {
		this.playedTime = e.currentFrame / e.sampleRate;
	}

	private onPlayUserMarkerEvent(e: PlayUserMarkerEventObject) {
		if (/^looped:/.test(e.marker)) {
			try {
				const loopStatus: LoopStatus = JSON.parse(
					e.marker.substring(7)
				);
				this.loopIndexCurrent = loopStatus.loopIndex;
				this.raiseEventPlayLooped(
					loopStatus,
					e.currentFrame,
					e.sampleRate
				);
			} catch {
				// do nothing
			}
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
			if (
				stopPosition.numerator * o.notePosDenominator <=
				stopPosition.denominator * o.notePosNumerator
			) {
				break;
			}
			curPos.numerator = o.notePosNumerator;
			curPos.denominator = o.notePosDenominator;
			this.processObject(
				o,
				index + 1,
				notesAndControls.length,
				curPos,
				currentTime,
				null,
				true
			);
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
			return this.sendSysEx(o.rawData, time);
		} else if (o instanceof TempoControl) {
			// process tempo
			this.queuedNotesBaseTime = this.queuedNotesTime;
			this.queuedNotesBasePos = {
				numerator: curPos.numerator,
				denominator: curPos.denominator,
			};
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
			const ch =
				this.channels[o.channel] ||
				(this.channels[o.channel] = makeDefaultChannelStatus());
			if (o.value1 === 0) {
				// Bank select MSB
				const val = o.value2 * 0x80;
				if (typeof ch.bank === 'number') {
					ch.bank = (ch.bank & 0x7f) + val;
				} else {
					ch.bank = val;
				}
			} else if (o.value1 === 32) {
				// Bank select LSB
				const val = o.value2;
				if (typeof ch.bank === 'number') {
					ch.bank = Math.floor(ch.bank / 0x80) * 0x80 + val;
				} else {
					ch.bank = val;
				}
			} else if (o.value1 === 7) {
				// Volume MSB
				return this.changeVolume(o.channel, true, o.value2, time);
			} else if (o.value1 === 39) {
				// Volume LSB
				return this.changeVolume(o.channel, false, o.value2, time);
			}
			return this.doSendEvent(
				{
					type: JSSynth.SequencerEventTypes.EventType.ControlChange,
					channel: o.channel,
					control: o.value1,
					value: o.value2,
				},
				time
			);
		} else if (o instanceof ProgramChangeControl) {
			return this.changeProgram(o.channel, o.value, null, time);
		} else if (o instanceof NoteObject) {
			if (noSound) {
				return true;
			}
			const cont = this.sendEvent(
				{
					type: JSSynth.SequencerEventTypes.EventType.NoteOn,
					channel: o.channel,
					key: o.noteValue,
					vel: o.velocity,
				},
				time
			);

			++this._allPlayedNoteCount;
			this.raiseEventPlayQueue(
				index,
				totalObjects,
				this._playingNotes.length,
				this._allPlayedNoteCount
			);

			const stopPos = new PositionObject(
				o.noteLengthNumerator,
				o.noteLengthDenominator
			);
			stopPos.addPositionMe(curPos);
			if (endTimePos) {
				if (
					stopPos.numerator * endTimePos.denominator >
					endTimePos.numerator * stopPos.denominator
				) {
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
					if (
						o.playEndPosNum * n.playEndPosDen! <
						n.playEndPosNum! * o.playEndPosDen
					) {
						this._playingNotes.splice(j, 0, o);
						break;
					}
				}
			}
			return cont;
		} else {
			try {
				const ev = makeEventData(o);
				return this.sendEvent(ev, time);
			} catch (_ex) {
				// do nothing for exception
				return true;
			}
		}
	}

	private processPlayingNotes(nextObject?: ISequencerObject) {
		const basePos = this.queuedNotesBasePos!;
		const curPos = this.queuedNotesPos!;
		if (this._playingNotes.length) {
			const n = this._playingNotes[0];
			if (
				!nextObject ||
				n.playEndPosNum! * nextObject.notePosDenominator <=
					nextObject.notePosNumerator * n.playEndPosDen!
			) {
				this._playingNotes.shift();
				curPos.numerator = n.playEndPosNum!;
				curPos.denominator = n.playEndPosDen!;
				const time2 = (this.queuedNotesTime =
					this.queuedNotesBaseTime +
					calcTimeExFromSMFTempo(
						this.tempo,
						basePos.numerator,
						basePos.denominator,
						curPos.numerator,
						curPos.denominator
					));
				this.sendEvent(
					{
						type: JSSynth.SequencerEventTypes.EventType.NoteOn,
						channel: n.channel,
						key: n.noteValue,
						vel: 0,
					},
					time2
				);
				this.raiseEventPlayEndNote(
					this._playingNotes.length,
					this._allPlayedNoteCount
				);
				return true;
			}
		}
		return false;
	}

	private noteOffAllPlayingNotes(timeToOff: TimeValue) {
		let len = this._playingNotes.length;
		this._playingNotes.splice(0).forEach((n) => {
			this.sendEvent(
				{
					type: JSSynth.SequencerEventTypes.EventType.NoteOn,
					channel: n.channel,
					key: n.noteValue,
					vel: 0,
				},
				timeToOff
			);
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
		if (this._nextPlayTimerId !== null) {
			throw new Error('Unexpected');
		}

		void this.startPlayer(actx, dest).then(() => {
			this._allPlayedNoteCount = 0;
			this._availablePlayNote = true;
			// this._prepareToPlayNotes(notesAndControls, from, to);
			this._isPlayingSequence = true;

			const startIndex = this.prepareBasePos(
				notesAndControls,
				from,
				timeStartOffset
			);

			this.channels.forEach((ch, i) => {
				if (ch) {
					if (typeof ch.bank === 'number') {
						this.sendEvent(
							{
								type:
									JSSynth.SequencerEventTypes.EventType
										.ControlChange,
								channel: i,
								control: 0, // Bank MSB
								value: Math.floor(ch.bank / 0x80),
							},
							0
						);
						if ((ch.bank & 0x7f) !== 0) {
							this.sendEvent(
								{
									type:
										JSSynth.SequencerEventTypes.EventType
											.ControlChange,
									channel: i,
									control: 32, // Bank LSB
									value: ch.bank & 0x7f,
								},
								0
							);
						}
					}
					if (typeof ch.preset === 'number') {
						this.changeProgram(i, ch.preset, null, 0);
					}
				}
			});

			const loopCount = loopData?.loopCount;
			let loopStatus: LoopStatus | undefined = loopData && {
				start: loopData.start || { numerator: 0, denominator: 1 },
				end: loopData.end,
				loopCount: typeof loopCount === 'number' ? loopCount : null,
				loopIndex: 0,
			};
			const fadeoutData =
				typeof fadeout === 'boolean'
					? fadeout
						? { enabled: true }
						: void 0
					: fadeout;
			if (fadeoutData?.enabled) {
				this.fadeout = {
					progress: false,
					// zero is not allowed
					// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
					step: fadeoutData.step || Constants.DefaultFadeoutStep,
					startTimeFromLoop:
						typeof fadeoutData.startTimeFromLoop === 'number'
							? fadeoutData.startTimeFromLoop
							: Constants.DefaultFadeoutStartTime,
					fadeoutTime:
						typeof fadeoutData.fadeoutTime === 'number'
							? fadeoutData.fadeoutTime
							: Constants.DefaultFadeoutTime,
					curStep: 0,
					startTime: 0,
					nextTime: 0,
				};
				if (!loopStatus) {
					loopStatus = {
						start: { numerator: 0, denominator: 1 },
						loopCount: 0,
						loopIndex: 0,
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
			let arr = (part.notes as readonly ISequencerObject[]).concat(
				part.controls
			);
			arr = arr.concat(this.engine.masterControls);
			if (backgroundChords && backgroundEndPos) {
				arr = arr.concat(
					convertBkChordsToNotes(backgroundChords, backgroundEndPos)
				);
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
		this.playPartRange(
			part,
			null,
			null,
			backgroundChords,
			backgroundEndPos,
			actx
		);
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
				arr = arr.concat(
					convertBkChordsToNotes(backgroundChords, backgroundEndPos)
				);
			}
			sortNotesAndControls(arr);

			this.startPlayData(
				arr,
				from,
				to,
				timeStartOffset,
				actx,
				dest,
				loopData,
				fadeout
			);
		}
	}

	/** Play sequence data from engine instance. */
	public playSequence(
		actx?: BaseAudioContext | null,
		dest?: AudioNode | null,
		loopData?: LoopData,
		fadeout?: FadeoutData | boolean
	) {
		this.playSequenceRange(
			null,
			null,
			null,
			null,
			null,
			actx,
			dest,
			loopData,
			fadeout
		);
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
				arr = arr.concat(
					convertBkChordsToNotes(backgroundChords, backgroundEndPos)
				);
			}
			sortNotesAndControls(arr);

			const r = calculatePositionFromSeconds(
				arr,
				60000000 / this.engine.tempo,
				timeFrom,
				timeTo,
				true
			);
			// if (!__PROD__ && r) {
			// 	console.log("From: " + r.from.numerator + "/" + r.from.denominator);
			// 	console.log("  StartOffset: " + r.timeStartOffset);
			// 	console.log("To: " + r.to.numerator + "/" + r.to.denominator);
			// 	console.log("  Duration: " + r.duration);
			// }

			this.startPlayData(
				arr,
				r?.from,
				r?.to,
				r?.timeStartOffset ?? 0,
				actx,
				dest,
				loopData,
				fadeout
			);
		}
	}

	public isPlaying(): boolean {
		this._checkStopped();
		return this._isPlayingSequence || this.isPlayerRunning();
	}

	protected preStopPlayer() {
		this._stopSequenceImpl();
	}

	protected preReleasePlayer() {
		this._stopSequenceImpl();
	}

	private _stopSequenceImpl() {
		this.stopPlayingNote();
		this._isPlayingSequence = false;
		this._playingNotes = [];
		this._allPlayedNoteCount = 0;
		this._availablePlayNote = false;
		if (this._nextPlayTimerId !== null) {
			window.clearTimeout(this._nextPlayTimerId);
			this._nextPlayTimerId = null;
		}
		// console.log('Do finish');
	}

	/**
	 * Stop the playing sequence data.
	 * The player data will be released after a few seconds, but
	 * it will be reused when playNote/playSequence* methods are called.
	 */
	public stopSequence(): void {
		this.stopPlayer();
	}

	public resetAll() {
		this.releasePlayer();

		this.engine.reset();
		this.engine.updateMasterControls();
		this.engine.raiseEventFileLoaded();
	}

	public getCurrentTimeWithLooped(
		timeCurrent: TimeRationalValue
	): TimeRationalValue {
		const d = this.loopDuration;
		let r = timeCurrent;
		if (d !== null) {
			let loopIndex = this.loopIndexCurrent;
			while (loopIndex--) {
				r = TimeRational.add(r, d);
			}
		}
		return r;
	}

	public calculateDurationWithLooped(
		loopData?: LoopData,
		fadeout?: FadeoutData | boolean
	): TimeRationalValue {
		let arr: ISequencerObject[] = [];
		this.engine.parts.forEach((p) => {
			arr = arr.concat(p.notes);
			arr = arr.concat(p.controls);
		});
		arr = arr.concat(this.engine.masterControls);
		sortNotesAndControls(arr);

		const r = calculatePositionFromSeconds2(
			arr,
			60000000 / this.engine.tempo,
			{ num: 0, den: 1 },
			null,
			true
		);
		if (r === null) {
			return { num: 0, den: 1 };
		}
		if (!loopData || typeof loopData.loopCount !== 'number') {
			return r.duration;
		}
		const r2 = calculateSecondsFromPosition2(
			arr,
			60000000 / this.engine.tempo,
			loopData?.start || { numerator: 0, denominator: 1 },
			loopData?.end || null,
			true
		);
		if (r2 === null) {
			return r.duration;
		}
		const baseDuration = r.duration;
		let loopDuration = TimeRational.sub(r2.timeTo, r2.timeFrom);
		loopDuration = {
			num: loopDuration.num * loopData.loopCount,
			den: loopDuration.den,
		};
		r.duration = TimeRational.add(r.duration, loopDuration);
		// false value == disabled
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (fadeout) {
			if (typeof fadeout === 'boolean') {
				fadeout = { enabled: true };
			}
			if (fadeout.enabled) {
				const startTimeFromLoop =
					typeof fadeout.startTimeFromLoop === 'number'
						? fadeout.startTimeFromLoop
						: Constants.DefaultFadeoutStartTime;
				const fadeoutTime =
					typeof fadeout.fadeoutTime === 'number'
						? fadeout.fadeoutTime
						: Constants.DefaultFadeoutTime;
				// duration - (baseDuration - loopEnd) + startTimeFromLoop + fadeoutTime
				r.duration = TimeRational.add(
					TimeRational.sub(
						r.duration,
						TimeRational.sub(baseDuration, r2.timeTo)
					),
					{ num: startTimeFromLoop + fadeoutTime, den: 1 }
				);
			}
		}
		return r.duration;
	}
}
