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
	public fromJSONObject(obj: any) {
		this.notes = [];
		this.controls = [];
		this.notes.length = obj.notes.length;
		this.controls.length = obj.controls.length;
		this.channel = obj.channel;
		for (let i = 0; i < this.notes.length; ++i) {
			this.notes[i] = new NoteObject(0, 0, 4, 4, 60, 0);
			this.notes[i].fromJSONObject(obj.notes[i]);
		}
		for (let i = 0; i < this.controls.length; ++i) {
			this.controls[i] = getControlFromJSONObject(obj.controls[i]);
		}
	}
}
