
import IPositionObject from 'objects/IPositionObject';

/** Time value (in seconds) */
export type TimeValue = number;

/** Loop data for play sequence */
export interface LoopData {
	/** Loop count (null or undefined or unspecified for infinite-loop) */
	loopCount?: number | null | undefined;
	/** Loop start position (null or undefined or unspecified for beginning of sequence) */
	start?: IPositionObject | null | undefined;
	/** Loop end position (null or undefined or unspecified for end of sequence) */
	end?: IPositionObject | null | undefined;
}
