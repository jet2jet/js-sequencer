
import ControlObject, { _objCtors } from 'core/controls/ControlObject';

import { isUndefined } from 'functions';

export default class SysExControl extends ControlObject {
	public rawData: Uint8Array;

	constructor();
	constructor(posNumerator: number, posDenominator: number, data: Uint8Array, move?: boolean);
	constructor(posNumerator: number, posDenominator: number, arrayBuffer: ArrayBuffer, offset?: number, len?: number);

	constructor(
		posNumerator?: number, posDenominator?: number,
		arrayBuffer?: ArrayBuffer | Uint8Array, offsetOrMove?: number | boolean, len?: number
	) {
		super();
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) {
			this.rawData = new Uint8Array(0);
			return;
		}
		if (arrayBuffer instanceof Uint8Array) {
			if (offsetOrMove) {
				this.rawData = arrayBuffer;
			} else {
				this.rawData = new Uint8Array(arrayBuffer);
			}
		} else {
			const dataLen = len || (arrayBuffer && arrayBuffer.byteLength) || 0;
			this.rawData = new Uint8Array(dataLen);
			if (dataLen) {
				this.rawData.set(new Uint8Array(arrayBuffer!, (offsetOrMove as number) || 0, dataLen));
			}
		}
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'SysExControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			rawData: ([] as number[]).slice.call(this.rawData)
		};
	}
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		this.rawData = new Uint8Array(obj.rawData.length);
		this.rawData.set(obj.rawData);
	}
	public equals(obj: any) {
		if (!obj || !(obj instanceof SysExControl)) {
			return false;
		}
		if (this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator) {
			return false;
		}
		if (!(this.rawData.byteLength === obj.rawData.byteLength)) {
			return false;
		}
		let l = this.rawData.byteLength;
		while (l--) {
			if (!(this.rawData[l] === obj.rawData[l])) {
				return false;
			}
		}
		return true;
	}
	public isEqualType(obj: any): obj is SysExControl {
		return obj instanceof SysExControl;
	}
	public isSimilar(obj: any) {
		return this.equals(obj);
	}
}
_objCtors.SysExControl = SysExControl;
