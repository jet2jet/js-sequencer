import Player from '../core/Player';
import EventObjectBase from './EventObjectBase';

export default class PlayQueueEventObject extends EventObjectBase {
	constructor(
		public readonly player: Player,
		public readonly current: number,
		public readonly total: number,
		public readonly playing: number,
		public readonly totalPlayed: number
	) {
		super();
	}
}
