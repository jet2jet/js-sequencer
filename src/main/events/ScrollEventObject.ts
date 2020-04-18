import SimpleEventObject from './SimpleEventObject';

import EditorEngine from '../core/EditorEngine';

export default class ScrollEventObject extends SimpleEventObject<EditorEngine> {
	public readonly value: number;

	constructor(editor: EditorEngine, value: number) {
		super(editor);
		this.value = value;
	}
	get editor() {
		return this.target;
	}
}
