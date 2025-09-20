import { isUndefined } from '../../functions';
import ControlObject from './ControlObject';

export default class EOTObject extends ControlObject {
	constructor();
	constructor(posNumerator: number, posDenominator: number);

	constructor(posNumerator?: number, posDenominator?: number) {
		super();
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) {
			return;
		}
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}

	public toJSON(): any {
		return {
			objType: 'EOTObject',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
		};
	}
	public fromJSONObject(obj: unknown): boolean {
		return super.fromJSONObject(obj);
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof EOTObject)) {
			return false;
		}
		return (
			this.notePosNumerator * obj.notePosDenominator ===
			this.notePosDenominator * obj.notePosNumerator
		);
	}
	public isEqualType(obj: unknown): obj is EOTObject {
		return obj instanceof EOTObject;
	}
}
