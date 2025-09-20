import { isUndefined } from '../../functions';
import { isObjectWithFields } from '../../functions/objectUtils';
import ControlObject, { _objCtors } from './ControlObject';

export default class TimeSignatureControl extends ControlObject {
	public beatsNumerator: number;
	public beatsDenominator: number;
	public clocks: number;
	public num32ndInQuater: number; // 24MIDIクロック(=MIDI4分音符)に入る32分音符の数

	constructor();
	constructor(
		posNumerator: number,
		posDenominator: number,
		beatsNumerator?: number,
		beatsDenominator?: number,
		cl?: number,
		num?: number
	);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		beatsNumerator?: number,
		beatsDenominator?: number,
		cl?: number,
		num?: number
	) {
		super();

		// zero is not allowed (use default values)
		this.beatsNumerator = beatsNumerator || 4;
		this.beatsDenominator = beatsDenominator || 4;
		if (isUndefined(cl)) cl = 24;
		if (isUndefined(num)) num = 8;
		this.clocks = cl;
		this.num32ndInQuater = num;

		if (isUndefined(posNumerator) || isUndefined(posDenominator)) return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}

	public toJSON(): any {
		return {
			objType: 'TimeSignatureControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			beatsNumerator: this.beatsNumerator,
			beatsDenominator: this.beatsDenominator,
			clocks: this.clocks,
			num32ndInQuater: this.num32ndInQuater,
		};
	}
	public fromJSONObject(obj: unknown): boolean {
		if (
			!isObjectWithFields(obj, {
				beatsNumerator: ['number'],
				beats: ['number'],
				beatsDenominator: ['number'],
				beatsFraction: ['number'],
				clocks: 'number',
				num32ndInQuater: 'number',
			})
		) {
			return false;
		}
		if (!super.fromJSONObject(obj)) {
			return false;
		}
		if (!isUndefined(obj.beatsNumerator))
			this.beatsNumerator = obj.beatsNumerator;
		else if (!isUndefined(obj.beats)) this.beatsNumerator = obj.beats;
		if (!isUndefined(obj.beatsDenominator))
			this.beatsDenominator = obj.beatsDenominator;
		else if (!isUndefined(obj.beatsFraction))
			this.beatsDenominator = obj.beatsFraction;
		this.clocks = obj.clocks;
		this.num32ndInQuater = obj.num32ndInQuater;
		return true;
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof TimeSignatureControl)) return false;
		return (
			this.notePosNumerator * obj.notePosDenominator ===
				this.notePosDenominator * obj.notePosNumerator &&
			this.beatsNumerator === obj.beatsNumerator &&
			this.beatsDenominator === obj.beatsDenominator
		);
	}
	public isEqualType(obj: unknown): obj is TimeSignatureControl {
		return obj instanceof TimeSignatureControl;
	}
}
_objCtors.TimeSignatureControl = TimeSignatureControl;
