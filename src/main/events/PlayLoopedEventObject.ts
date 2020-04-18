
import EventObjectBase from './EventObjectBase';

import Player from '../core/Player';
import IPositionObject from '../objects/IPositionObject';

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
