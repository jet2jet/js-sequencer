import { isObjectWithFields } from '../functions/objectUtils';
import ControlObject, {
	getControlFromJSONObject,
} from './controls/ControlObject';
import NoteObject from './NoteObject';

export default class Part {
	public notes: NoteObject[] = [];
	public controls: ControlObject[] = [];
	public channel: number = 0;

	public toJSON(): any {
		return this;
	}
	public static createFromJSONObject(obj: unknown): Part | null {
		const p = new Part();
		return p.fromJSONObject(obj) ? p : null;
	}
	public fromJSONObject(obj: unknown): boolean {
		if (
			!isObjectWithFields(obj, {
				notes: Array,
				controls: [Array],
				channel: ['number'],
			})
		) {
			return false;
		}
		const notes = obj.notes;
		const controls = obj.controls || [];
		if (typeof obj.channel === 'number') {
			this.channel = obj.channel;
		}
		this.notes = [];
		this.notes.length = notes.length;
		for (let i = 0; i < notes.length; ++i) {
			this.notes[i] = new NoteObject(0, 0, 4, 4, 60, 0);
			this.notes[i].fromJSONObject(notes[i]);
		}
		this.controls = [];
		for (let i = 0; i < controls.length; ++i) {
			const c = getControlFromJSONObject(controls[i]);
			if (c) {
				this.controls.push(c);
			}
		}
		return true;
	}
}
