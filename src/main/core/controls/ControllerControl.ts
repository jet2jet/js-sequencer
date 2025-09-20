import { isUndefined } from '../../functions';
import { isObjectWithFields } from '../../functions/objectUtils';
import ControlObject, { _objCtors } from './ControlObject';

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
		channel: number = 0,
		value1: number = 0,
		value2: number = 0
	) {
		super();
		this.channel = channel;
		this.value1 = value1;
		this.value2 = value2;
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
	public fromJSONObject(obj: unknown): boolean {
		if (
			!isObjectWithFields(obj, {
				channel: 'number',
				value1: 'number',
				value2: 'number',
			})
		) {
			return false;
		}
		if (!super.fromJSONObject(obj)) {
			return false;
		}
		this.channel = obj.channel;
		this.value1 = obj.value1;
		this.value2 = obj.value2;
		return true;
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof ControllerControl)) return false;
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
	public isEqualType(obj: unknown): obj is ControllerControl {
		return obj instanceof ControllerControl;
	}
	public compareTo(obj: unknown): number {
		if (!(obj instanceof ControllerControl)) return -1;
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
