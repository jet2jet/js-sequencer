
import SimpleEventObject from './SimpleEventObject';

import EditorEngine from '../core/EditorEngine';

export default class ResizeEventObject extends SimpleEventObject<EditorEngine> {
	public readonly width: number;
	public readonly height: number;

	constructor(editor: EditorEngine, width: number, height: number) {
		super(editor);
		this.width = width;
		this.height = height;
	}
	get editor() {
		return this.target;
	}
}
