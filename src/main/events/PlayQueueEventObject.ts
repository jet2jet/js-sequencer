import EventObjectBase from './EventObjectBase';

import Player from '../core/Player';

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
