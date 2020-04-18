import ControlObject, { _objCtors } from './ControlObject';

import { isUndefined } from '../../functions';

export default class PitchWheelControl extends ControlObject {
	public channel: number;
	public value: number;

	constructor();
	constructor(
		posNumerator: number,
		posDenominator: number,
		channel: number,
		value: number
	);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		channel?: number,
		value?: number
	) {
		super();
		this.channel = channel || 0;
		this.value = value || 0;
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'PitchWheelControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			channel: this.channel,
			value: this.value,
		};
	}
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		this.channel = obj.channel;
		this.value = obj.value;
	}
	public equals(obj: any) {
		if (!obj || !(obj instanceof PitchWheelControl)) return false;
		if (
			this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator
		)
			return false;
		return this.channel === obj.channel && this.value === obj.value;
	}
	public isEqualType(obj: any): obj is PitchWheelControl {
		return obj instanceof PitchWheelControl;
	}
	public isSimilar(obj: any) {
		return this.equals(obj);
	}
}
_objCtors.PitchWheelControl = PitchWheelControl;
