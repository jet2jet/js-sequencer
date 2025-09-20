import { isUndefined } from '../functions';
import { isObjectWithFields } from '../functions/objectUtils';
import { TimeValue } from '../types';
import NoteObjectBase from './NoteObjectBase';

export default class NoteObject implements NoteObjectBase {
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
		posNumerator: number,
		posDenominator: number,
		noteLength: number,
		noteLengthDenominator: number,
		noteValue: number,
		channel: number
	);

	constructor(
		posNumerator: number = 0,
		posDenominator: number = 1,
		noteLengthNumerator: number = 0,
		noteLengthDenominator: number = 1,
		noteValue: number = 0,
		channel: number = 0
	) {
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator !== 0 ? posDenominator : 1;
		this.noteLengthNumerator = noteLengthNumerator;
		this.noteLengthDenominator =
			noteLengthDenominator !== 0 ? noteLengthDenominator : 1;
		this.noteValue = noteValue;
		this.channel = channel;
		this.velocity = 100;
		this.idData = 0;

		this.x = this.y = 0;
	}

	public toJSON(): any {
		return {
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			noteLengthNumerator: this.noteLengthNumerator,
			noteLengthDenominator: this.noteLengthDenominator,
			noteValue: this.noteValue,
			channel: this.channel,
			velocity: this.velocity,
		};
	}
	public fromJSONObject(obj: unknown): boolean {
		if (
			!isObjectWithFields(obj, {
				notePosNumerator: ['number'],
				notePos: ['number'],
				notePosDenominator: ['number'],
				notePosFraction: ['number'],
				noteLengthNumerator: ['number'],
				noteLength: ['number'],
				noteLengthDenominator: ['number'],
				noteLengthFraction: ['number'],
				noteValue: 'number',
				channel: 'number',
				velocity: 'number',
			})
		) {
			return false;
		}
		if (!isUndefined(obj.notePosNumerator)) {
			this.notePosNumerator = obj.notePosNumerator;
		} else if (!isUndefined(obj.notePos)) {
			this.notePosNumerator = obj.notePos;
		}
		if (!isUndefined(obj.notePosDenominator)) {
			this.notePosDenominator = obj.notePosDenominator;
		} else if (!isUndefined(obj.notePosFraction)) {
			this.notePosDenominator = obj.notePosFraction;
		}
		if (!isUndefined(obj.noteLengthNumerator)) {
			this.noteLengthNumerator = obj.noteLengthNumerator;
		} else if (!isUndefined(obj.noteLength)) {
			this.noteLengthNumerator = obj.noteLength;
		}
		if (!isUndefined(obj.noteLengthDenominator)) {
			this.noteLengthDenominator = obj.noteLengthDenominator;
		} else if (!isUndefined(obj.noteLengthFraction)) {
			this.noteLengthDenominator = obj.noteLengthFraction;
		}
		this.noteValue = obj.noteValue;
		this.channel = obj.channel;
		this.velocity = obj.velocity;
		return true;
	}
	public setPosition(numerator: number, denominator: number): void {
		this.notePosNumerator = numerator;
		this.notePosDenominator = denominator;
	}
	public setLength(numerator: number, denominator: number): void {
		this.noteLengthNumerator = numerator;
		this.noteLengthDenominator = denominator;
	}
	public setNoteValue(value: number): void {
		this.noteValue = value;
	}
}

export function isNoteObject(obj: unknown): obj is NoteObject {
	return obj instanceof NoteObject;
}
