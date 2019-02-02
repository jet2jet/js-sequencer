
import ControlObject, { _objCtors } from './ControlObject';

import { isUndefined } from '../../functions';

export default class AftertouchControl extends ControlObject {
	public noteValue: number;
	public channel: number;
	public value: number;

	constructor();
	constructor(posNumerator: number, posDenominator: number, noteValue: number, channel: number, value: number);

	constructor(posNumerator?: number, posDenominator?: number, noteValue?: number, channel?: number, value?: number) {
		super();
		this.noteValue = noteValue || 0;
		this.channel = channel || 0;
		this.value = value || 0;
		if (isUndefined(posNumerator) || isUndefined(posDenominator))
			return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'AftertouchControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			noteValue: this.noteValue,
			channel: this.channel,
			value: this.value
		};
	}
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		this.noteValue = obj.noteValue;
		this.channel = obj.channel;
		this.value = obj.value;
	}
	public equals(obj: any) {
		if (!obj || !(obj instanceof AftertouchControl))
			return false;
		if (this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator)
			return false;
		return this.noteValue === obj.noteValue &&
			this.channel === obj.channel &&
			this.value === obj.value;
	}
	public isEqualType(obj: any): obj is AftertouchControl {
		return obj instanceof AftertouchControl;
	}
	public isSimilar(obj: any) {
		return this.equals(obj);
	}
}
_objCtors.AftertouchControl = AftertouchControl;
