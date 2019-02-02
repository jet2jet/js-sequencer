
import { TimeValue } from '../types';

import Engine from './Engine';
import NoteObjectBase from './NoteObjectBase';

import { isUndefined } from '../functions';

export default class NoteObject implements NoteObjectBase {
	public engine?: Engine | null;
	public notePosNumerator: number;
	public notePosDenominator: number;
	public noteLengthNumerator: number;
	public noteLengthDenominator: number;
	public noteValue: number;
	public channel: number;
	public velocity: number;
	public idData: number;

	public playStartTime?: TimeValue;
	public playEndTime?: TimeValue;
	public playEndPosNum?: number;
	public playEndPosDen?: number;

	// for editor
	public x: number;
	public y: number;
	public element?: HTMLElement;

	// for player
	public node?: AudioNode;

	constructor();
	constructor(
		posNumerator: number, posDenominator: number,
		noteLength: number, noteLengthDenominator: number, noteValue: number, channel: number
	);

	constructor(
		posNumerator?: number, posDenominator?: number,
		noteLengthNumerator?: number, noteLengthDenominator?: number, noteValue?: number, channel?: number
	) {
		this.engine = null;
		this.notePosNumerator = posNumerator || 0;
		this.notePosDenominator = posDenominator || 1;
		this.noteLengthNumerator = noteLengthNumerator || 0;
		this.noteLengthDenominator = noteLengthDenominator || 1;
		this.noteValue = noteValue || 0;
		this.channel = channel || 0;
		this.velocity = 100;
		this.idData = 0;

		this.x = this.y = 0;
	}

	public attachEngine(engine: Engine) {
		this.detachEngine();
		this.engine = engine;
		if (engine)
			engine._afterAttachEngine(this);
	}

	public detachEngine() {
		if (this.engine) {
			this.engine._beforeDetachEngine(this);
			this.engine = null;
		}
	}
	public toJSON(): any {
		return {
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			noteLengthNumerator: this.noteLengthNumerator,
			noteLengthDenominator: this.noteLengthDenominator,
			noteValue: this.noteValue,
			channel: this.channel,
			velocity: this.velocity
		};
	}
	public fromJSONObject(obj: any) {
		if (!isUndefined(obj.notePosNumerator))
			this.notePosNumerator = obj.notePosNumerator;
		else
			this.notePosNumerator = obj.notePos;
		if (!isUndefined(obj.notePosDenominator))
			this.notePosDenominator = obj.notePosDenominator;
		else
			this.notePosDenominator = obj.notePosFraction;
		if (!isUndefined(obj.noteLengthNumerator))
			this.noteLengthNumerator = obj.noteLengthNumerator;
		else
			this.noteLengthNumerator = obj.noteLength;
		if (!isUndefined(obj.noteLengthDenominator))
			this.noteLengthDenominator = obj.noteLengthDenominator;
		else
			this.noteLengthDenominator = obj.noteLengthFraction;
		this.noteValue = obj.noteValue;
		this.channel = obj.channel;
		this.velocity = obj.velocity;
	}
	public setPosition(numerator: number, denominator: number) {
		this.notePosNumerator = numerator;
		this.notePosDenominator = denominator;
	}
	public setLength(numerator: number, denominator: number) {
		this.noteLengthNumerator = numerator;
		this.noteLengthDenominator = denominator;
	}
	public setNoteValue(value: number) {
		this.noteValue = value;
	}
}

export function isNoteObject(obj: any): obj is NoteObject {
	return obj instanceof NoteObject;
}
