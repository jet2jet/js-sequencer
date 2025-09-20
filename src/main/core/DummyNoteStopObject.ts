import type NoteObjectBase from './NoteObjectBase';

/** @internal */
export default class DummyNoteStopObject implements NoteObjectBase {
	public notePosNumerator: number;
	public notePosDenominator: number;
	public noteLengthNumerator: number;
	public noteLengthDenominator: number;
	public noteValue: number;
	public channel: number;
	public idData: number;

	constructor(
		posNumerator: number,
		posDenominator: number,
		channel: number,
		noteValue: number
	) {
		this.notePosNumerator = posNumerator;
		this.notePosDenominator = posDenominator;
		this.noteLengthNumerator = 0;
		this.noteLengthDenominator = 0;
		this.channel = channel;
		this.noteValue = noteValue;
		this.idData = 0;
	}
}
