import type Player from '../core/Player';
import type IPositionObject from '../objects/IPositionObject';
import EventObjectBase from './EventObjectBase';

export default class PlayLoopedEventObject extends EventObjectBase {
	constructor(
		public readonly player: Player,
		public readonly loopStart: IPositionObject,
		public readonly loopEnd: IPositionObject | null,
		public readonly loopCount: number,
		public readonly currentFrame: number,
		public readonly sampleRate: number
	) {
		super();
	}
}
