
import EventObjectBase from 'events/EventObjectBase';

import PlayerBase from 'core/PlayerBase';

export default class PlayUserEventObject extends EventObjectBase {
	constructor(
		public readonly player: PlayerBase,
		public readonly type: string,
		public readonly data: any
	) {
		super();
	}
}
