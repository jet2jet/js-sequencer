import ControlObject, { _objCtors } from './ControlObject';

import { isUndefined } from '../../functions';

export default class ControllerControl extends ControlObject {
	public channel: number;
	public value1: number;
	public value2: number;

	constructor();
	constructor(
		posNumerator: number,
		posDenominator: number,
		channel: number,
		value1: number,
		value2: number
	);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		channel?: number,
		value1?: number,
		value2?: number
	) {
		super();
		this.channel = channel || 0;
		this.value1 = value1 || 0;
		this.value2 = value2 || 0;
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'ControllerControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			channel: this.channel,
			value1: this.value1,
			value2: this.value2,
		};
	}
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		this.channel = obj.channel;
		this.value1 = obj.value1;
		this.value2 = obj.value2;
	}
	public equals(obj: any) {
		if (!obj || !(obj instanceof ControllerControl)) return false;
		if (
			this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator
		)
			return false;
		return (
			this.channel === obj.channel &&
			this.value1 === obj.value1 &&
			this.value2 === obj.value2
		);
	}
	public isEqualType(obj: any): obj is ControllerControl {
		return obj instanceof ControllerControl;
	}
	public isSimilar(obj: any) {
		return this.equals(obj);
	}
	public compareTo(obj: any): number {
		if (!obj || !(obj instanceof ControllerControl)) return -1;
		if (this.channel !== obj.channel) return this.channel - obj.channel;
		// DATA MSB/LSB must follow another controls (for sorting)
		if (this.value1 === 6 || this.value1 === 38)
			// DATA MSB/LSB
			return obj.value1 !== 6 && obj.value1 !== 38 ? 1 : 0;
		if (obj.value1 === 6 || obj.value1 === 38)
			// DATA MSB/LSB
			return -1;
		return this.idData - obj.idData;
	}
}
_objCtors.ControllerControl = ControllerControl;
