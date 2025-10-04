export interface AudioWorkletOptions {
	prerenderFrames: number;
	maxQueueFrames: number;
}

export interface AudioWorkletProcessorOptions {
	options: AudioWorkletOptions;
	workletProcessMode?: boolean;
}
