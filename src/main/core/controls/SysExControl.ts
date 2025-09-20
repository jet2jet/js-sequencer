import { isUndefined } from '../../functions';
import { isObjectWithFields } from '../../functions/objectUtils';
import ControlObject, { _objCtors } from './ControlObject';

export default class SysExControl extends ControlObject {
	public rawData: Uint8Array;

	constructor();
	constructor(
		posNumerator: number,
		posDenominator: number,
		data: Uint8Array,
		move?: boolean
	);
	constructor(
		posNumerator: number,
		posDenominator: number,
		arrayBuffer: ArrayBuffer,
		offset?: number,
		len?: number
	);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		arrayBuffer?: ArrayBuffer | Uint8Array,
		offsetOrMove?: number | boolean,
		len?: number
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
			// zero is not allowed
			const dataLen = len || arrayBuffer?.byteLength || 0;
			this.rawData = new Uint8Array(dataLen);
			if (dataLen) {
				this.rawData.set(
					new Uint8Array(
						arrayBuffer!,
						(offsetOrMove as number) || 0,
						dataLen
					)
				);
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
			rawData: ([] as number[]).slice.call(this.rawData),
		};
	}
	public fromJSONObject(obj: unknown): boolean {
		if (!isObjectWithFields(obj, { rawData: Array })) {
			return false;
		}
		if (!super.fromJSONObject(obj)) {
			return false;
		}
		this.rawData = new Uint8Array(obj.rawData.length);
		this.rawData.set(obj.rawData.filter((c) => typeof c === 'number'));
		return true;
	}
	public equals(obj: unknown): boolean {
		if (!(obj instanceof SysExControl)) {
			return false;
		}
		if (
			this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator
		) {
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
	public isEqualType(obj: unknown): obj is SysExControl {
		return obj instanceof SysExControl;
	}
}
_objCtors.SysExControl = SysExControl;
