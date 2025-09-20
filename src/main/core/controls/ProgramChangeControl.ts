import { isUndefined } from '../../functions';
import { isObjectWithFields } from '../../functions/objectUtils';
import ControlObject, { _objCtors } from './ControlObject';

export default class ProgramChangeControl extends ControlObject {
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
			objType: 'ProgramChangeControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			channel: this.channel,
			value: this.value,
		};
	}
	public fromJSONObject(obj: unknown): boolean {
		if (!isObjectWithFields(obj, { channel: 'number', value: 'number' })) {
			return false;
		}
		if (!super.fromJSONObject(obj)) {
			return false;
		}
		this.channel = obj.channel;
		this.value = obj.value;
		return true;
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof ProgramChangeControl)) {
			return false;
		}
		if (
			this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator
		)
			return false;
		return this.channel === obj.channel && this.value === obj.value;
	}
	public isEqualType(obj: unknown): obj is ProgramChangeControl {
		return obj instanceof ProgramChangeControl;
	}
}
_objCtors.ProgramChangeControl = ProgramChangeControl;
