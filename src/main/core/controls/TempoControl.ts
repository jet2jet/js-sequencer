import { isUndefined } from '../../functions';
import { isObjectWithFields } from '../../functions/objectUtils';
import ControlObject, { _objCtors } from './ControlObject';

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
		this.value = value || 500000;
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) {
			return;
		}
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
	public fromJSONObject(obj: unknown): boolean {
		if (!isObjectWithFields(obj, { value: 'number' })) {
			return false;
		}
		if (!super.fromJSONObject(obj)) {
			return false;
		}
		this.value = obj.value;
		return true;
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof TempoControl)) {
			return false;
		}
		return (
			this.notePosNumerator * obj.notePosDenominator ===
				this.notePosDenominator * obj.notePosNumerator &&
			this.value === obj.value
		);
	}
	public isEqualType(obj: unknown): obj is TempoControl {
		return obj instanceof TempoControl;
	}
}
_objCtors.TempoControl = TempoControl;
