import Engine from '../core/Engine';

/**
 * Abstract sequencer object used by Engine and Player.
 */
export default interface ISequencerObject {
	/** associated Engine instance */
	engine?: Engine | null;
	/** numerator value of data position */
	notePosNumerator: number;
	/** denominator value of data position (zero is not allowed and causes unexpected behavior) */
	notePosDenominator: number;
	/** MIDI channel number (zero-based), or undefined if not required (such as TempoControl) */
	channel?: number;
	/** internal identifier value used by sort for Engine instance */
	idData?: number;

	/** used by EditorEngine internally */
	element?: HTMLElement;

	toJSON?(): any;
	fromJSONObject?(obj: any): void;
	equals?(obj: any): boolean;
	isEqualType?(obj: any): boolean;
	isEqualPosition?(obj: any): boolean;
	compareTo?(obj: any): number;

	attachEngine?(engine: Engine): void;
	detachEngine?(): void;
}
