
import Options from 'core/playing/Options';

export default interface IPlayStream {
	startStreaming?(sampleRate: number, options: Options): void;
	stopStreaming?(): void;
	releaseStream?(): void;
	renderFrames(sampleRate: number, framesLeft: ArrayBuffer, framesRight: ArrayBuffer): void;
}
