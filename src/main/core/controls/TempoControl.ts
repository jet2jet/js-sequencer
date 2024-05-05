import ControlObject, { _objCtors } from './ControlObject';

import { isUndefined } from '../../functions';

export default class TempoControl extends ControlObject {
	/** BPM = 60000000 / value */
	public value: number;

	constructor();
	constructor(posNumerator: number, posDenominator: number, value?: number);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		value?: number
	) {
		super();
		// zero is not allowed (use default value)
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		this.value = value || 500000;
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}

	public toJSON(): any {
		return {
			objType: 'TempoControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			value: this.value,
		};
	}
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		this.value = obj.value;
	}
	public equals(obj: any) {
		if (!(obj instanceof TempoControl)) return false;
		return (
			this.notePosNumerator * obj.notePosDenominator ===
				this.notePosDenominator * obj.notePosNumerator &&
			this.value === obj.value
		);
	}
	public isEqualType(obj: any): obj is TempoControl {
		return obj instanceof TempoControl;
	}
}
_objCtors.TempoControl = TempoControl;
