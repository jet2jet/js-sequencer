import { isUndefined } from '../../functions';
import ControlObject, { _objCtors } from './ControlObject';

export default class SysMsgControl extends ControlObject {
	public msgType: number;
	public rawData: Uint8Array;

	constructor();
	constructor(
		posNumerator: number,
		posDenominator: number,
		type: number,
		arrayBuffer: ArrayBuffer,
		offset?: number,
		len?: number
	);

	constructor(
		posNumerator?: number,
		posDenominator?: number,
		type: number = 0,
		arrayBuffer?: ArrayBuffer,
		offset: number = 0,
		len?: number
	) {
		super();
		this.msgType = type;
		const dataLen =
			typeof len === 'number'
				? len
				: (arrayBuffer && arrayBuffer.byteLength - offset) || 0;
		this.rawData = new Uint8Array(dataLen);
		if (dataLen) {
			this.rawData.set(
				new Uint8Array(arrayBuffer!, offset || 0, dataLen)
			);
		}
		if (isUndefined(posNumerator) || isUndefined(posDenominator)) return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'SysMsgControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			msgType: this.msgType,
			rawData: ([] as number[]).slice.call(this.rawData),
		};
	}
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		this.msgType = obj.msgType;
		this.rawData = new Uint8Array(obj.rawData.length);
		this.rawData.set(obj.rawData);
	}
	public equals(obj: any) {
		if (!(obj instanceof SysMsgControl)) return false;
		if (
			this.notePosNumerator * obj.notePosDenominator !==
			this.notePosDenominator * obj.notePosNumerator
		)
			return false;
		if (
			!(this.msgType === obj.msgType) ||
			!(this.rawData.byteLength === obj.rawData.byteLength)
		)
			return false;
		let l = this.rawData.byteLength;
		while (l--) {
			if (!(this.rawData[l] === obj.rawData[l])) return false;
		}
		return true;
	}
	public isEqualType(obj: any): obj is SysMsgControl {
		return obj instanceof SysMsgControl;
	}
}
_objCtors.SysMsgControl = SysMsgControl;
