import type PlayerBase from '../core/PlayerBase';
import EventObjectBase from './EventObjectBase';

export default class PlayStatusEventObject extends EventObjectBase {
	constructor(
		public readonly player: PlayerBase,
		public readonly currentFrame: number,
		public readonly sampleRate: number
	) {
		super();
	}
}
