import { isUndefined } from '../functions';
import { isObjectWithFields } from '../functions/objectUtils';

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
	public fromJSONObject(obj: unknown): boolean {
		if (
			!isObjectWithFields(obj, {
				posNumerator: ['number'],
				position: ['number'],
				posDenominator: ['number'],
				positionFraction: ['number'],
				rootNote: 'number',
				notes: Array,
			})
		) {
			return false;
		}
		if (!isUndefined(obj.posNumerator)) {
			this.posNumerator = obj.posNumerator;
		} else if (!isUndefined(obj.position)) {
			this.posNumerator = obj.position;
		}
		if (!isUndefined(obj.posDenominator)) {
			this.posDenominator = obj.posDenominator;
		} else if (!isUndefined(obj.positionFraction)) {
			this.posDenominator = obj.positionFraction;
		}
		this.rootNote = obj.rootNote;
		this.notes = obj.notes.filter((n) => typeof n === 'number');
		return true;
	}
}
