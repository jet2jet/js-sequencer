import SimpleEventObject from './SimpleEventObject';

import EditorEngine from '../core/EditorEngine';

export default class MaxChangedEventObject extends SimpleEventObject<
	EditorEngine
> {
	public readonly max: number;
	public readonly posNumerator: number;
	public readonly posDenominator: number;

	constructor(
		editor: EditorEngine,
		max: number,
		posNumerator: number,
		posDenominator: number
	) {
		super(editor);
		this.max = max;
		this.posNumerator = posNumerator;
		this.posDenominator = posDenominator;
	}
	get editor() {
		return this.target;
	}
}
