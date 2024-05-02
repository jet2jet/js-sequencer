import { isUndefined } from '../functions';

export default class BackgroundChord {
	public posNumerator: number;
	public posDenominator: number;
	public rootNote: number | null;
	public notes: number[];

	constructor(
		posNum: number,
		posDen: number,
		root: number | null,
		notes: number[]
	) {
		this.posNumerator = posNum;
		this.posDenominator = posDen;
		this.rootNote = root;
		this.notes = ([] as number[]).concat(notes);
	}
	public toJSON(): any {
		return this;
	}
	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	public fromJSONObject(obj: any): void {
		if (!isUndefined(obj.posNumerator)) {
			this.posNumerator = obj.posNumerator;
		} else {
			this.posNumerator = obj.position;
		}
		if (!isUndefined(obj.posDenominator)) {
			this.posDenominator = obj.posDenominator;
		} else {
			this.posDenominator = obj.positionFraction;
		}
		this.posDenominator = obj.posDenominator;
		this.rootNote = obj.rootNote;
		this.notes = obj.notes;
	}
}
