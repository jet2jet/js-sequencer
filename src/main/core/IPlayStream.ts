
import Options from 'core/playing/Options';

export default interface IPlayStream {
	startStreaming?(sampleRate: number, options: Options): void;
	pauseStreaming?(isPaused: boolean): void;
	stopStreaming?(): void;
	releaseStream?(): void;
	renderFrames(sampleRate: number, framesLeft: ArrayBuffer, framesRight: ArrayBuffer, isPaused: boolean): void;
}
