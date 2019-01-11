
export default class FrameQueue {

	private frames: Array<[ArrayBuffer, ArrayBuffer]> = [];
	private curFrames: [Float32Array, Float32Array] | undefined;
	private offset: number = 0;
	private queuedFrames = 0;

	public pushFrames(rawFrames: [ArrayBuffer, ArrayBuffer]) {
		if (!this.curFrames) {
			this.curFrames = [new Float32Array(rawFrames[0]), new Float32Array(rawFrames[1])];
		} else {
			this.frames.push(rawFrames);
		}
		this.queuedFrames += rawFrames[0].byteLength / 4;
	}

	public popFrames(): [Float32Array, Float32Array] | undefined {
		const cf = this.curFrames;
		if (!cf) {
			return void 0;
		}
		this.nextFrame();
		this.queuedFrames -= cf[0].length;
		return cf;
	}

	public getFrameCountInQueue() {
		return this.queuedFrames;
	}

	public isEmpty() {
		return !this.queuedFrames;
	}

	public clear() {
		this.frames.splice(0);
		this.curFrames = void 0;
		this.queuedFrames = 0;
	}

	public outputFrames(dest: [Float32Array, Float32Array]) {
		let cf = this.curFrames;
		if (!cf) {
			return 0;
		}
		let framesCopied = 0;
		while (true) {
			const bufferFrames = cf[0].length;
			const offset = this.offset;
			let copyFrames = dest[0].length - framesCopied;
			if (offset + copyFrames > bufferFrames) {
				copyFrames = bufferFrames - offset;
			}
			const lastFrame = offset + copyFrames;
			dest[0].set(cf[0].subarray(offset, lastFrame), framesCopied);
			dest[1].set(cf[1].subarray(offset, lastFrame), framesCopied);
			framesCopied += copyFrames;
			if (lastFrame < bufferFrames) {
				this.offset = lastFrame;
				break;
			}
			cf = this.nextFrame();
			if (!cf) {
				break;
			}
		}
		this.queuedFrames -= framesCopied;
		return framesCopied;
	}

	private nextFrame() {
		this.offset = 0;
		const newF = this.frames.shift();
		if (!newF) {
			return (this.curFrames = void (0));
		}
		return (this.curFrames = [new Float32Array(newF[0]), new Float32Array(newF[1])]);
	}
}
