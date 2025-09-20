import type ISequencerObject from '../objects/ISequencerObject';

export default interface NoteObjectBase extends ISequencerObject {
	notePosNumerator: number;
	notePosDenominator: number;
	noteLengthNumerator: number;
	noteLengthDenominator: number;
	noteValue: number;
	channel: number;
}
