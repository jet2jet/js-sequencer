import ControlObject, { _objCtors } from './ControlObject';

import { isUndefined } from '../../functions';

export default class PressureControl extends ControlObject {
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
		channel: number = 0,
		value: number = 0
	) {
		super();
		this.channel = channel;
		this.value = value;
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'PressureControl',
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
		if (!(obj instanceof PressureControl)) return false;
		if (
			this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator
		)
			return false;
		return this.channel === obj.channel && this.value === obj.value;
	}
	public isEqualType(obj: any): obj is PressureControl {
		return obj instanceof PressureControl;
	}
	public isSimilar(obj: any) {
		return this.equals(obj);
	}
}
_objCtors.PressureControl = PressureControl;
