import { isUndefined } from '../../functions';
import { isObjectWithFields } from '../../functions/objectUtils';
import ControlObject, { _objCtors } from './ControlObject';

export default class AftertouchControl extends ControlObject {
	public noteValue: number;
	public channel: number;
	public value: number;

	constructor();
	constructor(
		posNumerator: number,
		posDenominator: number,
		noteValue: number,
		channel: number,
		value: number
	);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		noteValue: number = 0,
		channel: number = 0,
		value: number = 0
	) {
		super();
		this.noteValue = noteValue;
		this.channel = channel;
		this.value = value;
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) return;
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
			value: this.value,
		};
	}
	public fromJSONObject(obj: unknown): boolean {
		if (
			!isObjectWithFields(obj, {
				noteValue: 'number',
				channel: 'number',
				value: 'number',
			})
		) {
			return false;
		}
		if (!super.fromJSONObject(obj)) {
			return false;
		}
		this.noteValue = obj.noteValue;
		this.channel = obj.channel;
		this.value = obj.value;
		return true;
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof AftertouchControl)) return false;
		if (
			this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator
		)
			return false;
		return (
			this.noteValue === obj.noteValue &&
			this.channel === obj.channel &&
			this.value === obj.value
		);
	}
	public isEqualType(obj: unknown): obj is AftertouchControl {
		return obj instanceof AftertouchControl;
	}
}
_objCtors.AftertouchControl = AftertouchControl;
