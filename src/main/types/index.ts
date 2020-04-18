import IPositionObject from '../objects/IPositionObject';

/** Time value (in seconds) */
export type TimeValue = number;

/** Time rational value in seconds; time = (num / den) */
export interface TimeRationalValue {
	num: number;
	den: number;
}

/** Loop data for play sequence */
export interface LoopData {
	/** Loop count (null or undefined or unspecified for infinite-loop) */
	loopCount?: number | null | undefined;
	/** Loop start position (null or undefined or unspecified for beginning of sequence) */
	start?: IPositionObject | null | undefined;
	/** Loop end position (null or undefined or unspecified for end of sequence) */
	end?: IPositionObject | null | undefined;
}

export interface FadeoutData {
	/** Whether fadeout feature is enabled */
	enabled: boolean;
	/** Fadeout step; division count for decreasement (default: 10) */
	step?: number;
	/** Fadeout start time from last loop (default: 0.0) */
	startTimeFromLoop?: TimeValue;
	/** Time (in seconds) for fadeout process (default: 4.0) */
	fadeoutTime?: TimeValue;
}
