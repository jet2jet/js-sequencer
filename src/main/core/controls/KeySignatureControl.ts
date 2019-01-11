
import ControlObject, { _objCtors } from 'core/controls/ControlObject';

import { isUndefined } from 'functions';

const KEY_SIGNATURE_NAMES = [
	'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
	'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm'
];

export default class KeySignatureControl extends ControlObject {
	public sharpFlat: number;
	public isMinor: boolean;

	constructor();
	constructor(posNumerator: number, posDenominator: number, sharpFlat?: number, isMinor?: boolean);

	constructor(posNumerator?: number, posDenominator?: number, sharpFlat?: number, isMinor?: boolean) {
		super();
		this.sharpFlat = sharpFlat || 0;
		this.isMinor = isMinor || false;
		if (isUndefined(posNumerator) || isUndefined(posDenominator))
			return;
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
	}
	public toJSON(): any {
		return {
			objType: 'KeySignatureControl',
			notePosNumerator: this.notePosNumerator,
			notePosDenominator: this.notePosDenominator,
			sharpFlat: this.sharpFlat, isMinor: this.isMinor
		};
	}
	public fromJSONObject(obj: any) {
		super.fromJSONObject(obj);
		this.sharpFlat = obj.sharpFlat;
		this.isMinor = obj.isMinor;
	}
	public equals(obj: any) {
		if (!obj || !(obj instanceof KeySignatureControl))
			return false;
		return this.notePosNumerator * obj.notePosDenominator ===
			this.notePosDenominator * obj.notePosNumerator &&
			this.sharpFlat === obj.sharpFlat &&
			this.isMinor === obj.isMinor;
	}
	public isEqualType(obj: any): obj is KeySignatureControl {
		return obj instanceof KeySignatureControl;
	}
	public getText() {
		let vPos = (this.sharpFlat >= 0) ? this.sharpFlat : 7 - this.sharpFlat;
		if (this.isMinor)
			vPos += 15;
		return 'Key: ' + KEY_SIGNATURE_NAMES[vPos];
	}
}
_objCtors.KeySignatureControl = KeySignatureControl;
