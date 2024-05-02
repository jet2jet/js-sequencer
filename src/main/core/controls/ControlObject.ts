import ISequencerObject from '../../objects/ISequencerObject';

/** @internal */
export const _objCtors: { [key: string]: typeof ControlObject | undefined } =
	{};

export default class ControlObject implements ISequencerObject {
	public notePosNumerator = 0;
	public notePosDenominator = 1;
	public parentArray: ControlObject[] | null = null;

	public idData: number = 0;

	// for editor
	public x: number = 0;
	public y: number = 0;
	public element?: HTMLElement;
	public textNode?: Text;

	public toJSON(): any {
		return {
			objType: 'ControlObject',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
		};
	}

	public fromJSONObject(obj: any) {
		this.parentArray = null;
		this.idData = 0;

		if (typeof obj.notePosNumerator === 'number') {
			this.notePosNumerator = obj.notePosNumerator;
		} else if (typeof obj.notePos === 'number') {
			this.notePosNumerator = obj.notePos;
		} else {
			this.notePosNumerator = 0;
		}
		if (typeof obj.notePosDenominator === 'number') {
			this.notePosDenominator = obj.notePosDenominator;
		} else if (typeof obj.notePosFraction === 'number') {
			this.notePosDenominator = obj.notePosFraction;
		} else {
			this.notePosDenominator = 1;
		}
		if (!this.notePosDenominator) {
			this.notePosDenominator = 1;
		}
	}

	public setPosition(numerator: number, denominator: number) {
		this.notePosNumerator = numerator;
		this.notePosDenominator = denominator;
	}

	public equals(obj: any) {
		return this === obj;
	}
	public isEqualType(obj: any): obj is ControlObject {
		return obj instanceof ControlObject;
	}
	public isEqualPosition(obj: any) {
		if (!(obj instanceof ControlObject)) {
			return false;
		}
		return (
			this.notePosNumerator * obj.notePosDenominator ===
			this.notePosDenominator * obj.notePosNumerator
		);
	}
	public isSimilar(obj: any) {
		return this.isEqualType(obj) && this.isEqualPosition(obj);
	}
}
_objCtors.ControlObject = ControlObject;

export function getControlFromJSONObject(obj: any): ControlObject {
	// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
	let t: string = obj.objType || 'ControlObject';
	// for compatibility
	if (t === 'EOFObject') {
		t = 'EOTObject';
	}
	const ctor = _objCtors[t] || ControlObject;
	const ret: ControlObject = Object.create(ctor.prototype) as ControlObject;
	ret.fromJSONObject(obj);
	return ret;
}
