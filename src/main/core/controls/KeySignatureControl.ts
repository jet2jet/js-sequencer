import { isUndefined } from '../../functions';
import { isObjectWithFields } from '../../functions/objectUtils';
import ControlObject, { _objCtors } from './ControlObject';

export default class KeySignatureControl extends ControlObject {
	public sharpFlat: number;
	public isMinor: boolean;

	constructor();
	constructor(
		posNumerator: number,
		posDenominator: number,
		sharpFlat?: number,
		isMinor?: boolean
	);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		sharpFlat: number = 0,
		isMinor: boolean = false
	) {
		super();
		this.sharpFlat = sharpFlat;
		this.isMinor = isMinor;
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) {
			return;
		}
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'KeySignatureControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			sharpFlat: this.sharpFlat,
			isMinor: this.isMinor,
		};
	}
	public fromJSONObject(obj: unknown): boolean {
		if (
			!isObjectWithFields(obj, {
				sharpFlat: 'number',
				isMinor: 'boolean',
			})
		) {
			return false;
		}
		if (!super.fromJSONObject(obj)) {
			return false;
		}
		this.sharpFlat = obj.sharpFlat;
		this.isMinor = obj.isMinor;
		return true;
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof KeySignatureControl)) {
			return false;
		}
		return (
			this.notePosNumerator * obj.notePosDenominator ===
				this.notePosDenominator * obj.notePosNumerator &&
			this.sharpFlat === obj.sharpFlat &&
			this.isMinor === obj.isMinor
		);
	}
	public isEqualType(obj: unknown): obj is KeySignatureControl {
		return obj instanceof KeySignatureControl;
	}
}
_objCtors.KeySignatureControl = KeySignatureControl;
