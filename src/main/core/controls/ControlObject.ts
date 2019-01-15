
import ISequencerObject from 'objects/ISequencerObject';

import Engine from 'core/Engine';

/** @internal */
export const _objCtors: { [key: string]: typeof ControlObject } = {};

export default class ControlObject implements ISequencerObject {
	public engine: Engine | null = null;
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
			notePosDenominator: this.notePosDenominator
		};
	}

	public fromJSONObject(obj: any) {
		this.engine = null;
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

	public attachEngine(engine: Engine) {
		this.detachEngine();
		this.engine = engine;
		if (engine) {
			engine._afterAttachEngine(this);
		}
	}

	public detachEngine() {
		if (this.engine) {
			this.engine._beforeDetachEngine(this);
			this.engine = null;
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
		if (!obj || !(obj instanceof ControlObject)) {
			return false;
		}
		return this.notePosNumerator * obj.notePosDenominator ===
			this.notePosDenominator * obj.notePosNumerator;
	}
	public isSimilar(obj: any) {
		return this.isEqualType(obj) && this.isEqualPosition(obj);
	}
	public getText() {
		return '';
	}
}
_objCtors.ControlObject = ControlObject;

export function getControlFromJSONObject(obj: any): ControlObject {
	let t: string = obj.objType || 'ControlObject';
	// for compatibility
	if (t === 'EOFObject') {
		t = 'EOTObject';
	}
	const ctor = _objCtors[t] || ControlObject;
	let ret: ControlObject;
	if (Object.create) {
		ret = Object.create(ctor.prototype) as ControlObject;
	} else {
		// tslint:disable-next-line:only-arrow-functions no-empty
		const fn: { prototype: any; new(): any; } = function() { } as typeof Object;
		fn.prototype = ctor.prototype;
		ret = new fn() as ControlObject;
	}
	ret.fromJSONObject(obj);
	return ret;
}
