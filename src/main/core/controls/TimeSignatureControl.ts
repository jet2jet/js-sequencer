import ControlObject, { _objCtors } from './ControlObject';

import { isUndefined } from '../../functions';

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
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		if (!isUndefined(obj.beatsNumerator))
			this.beatsNumerator = obj.beatsNumerator;
		else this.beatsNumerator = obj.beats;
		if (!isUndefined(obj.beatsDenominator))
			this.beatsDenominator = obj.beatsDenominator;
		else this.beatsDenominator = obj.beatsFraction;
		this.clocks = obj.clocks;
		this.num32ndInQuater = obj.num32ndInQuater;
	}
	public equals(obj: any) {
		if (!obj || !(obj instanceof TimeSignatureControl)) return false;
		return (
			this.notePosNumerator * obj.notePosDenominator ===
				this.notePosDenominator * obj.notePosNumerator &&
			this.beatsNumerator === obj.beatsNumerator &&
			this.beatsDenominator === obj.beatsDenominator
		);
	}
	public isEqualType(obj: any): obj is TimeSignatureControl {
		return obj instanceof TimeSignatureControl;
	}
	public getText() {
		return `Time: ${this.beatsNumerator}/${this.beatsDenominator}`;
	}
}
_objCtors.TimeSignatureControl = TimeSignatureControl;
