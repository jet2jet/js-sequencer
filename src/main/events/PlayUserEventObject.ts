
import EventObjectBase from 'events/EventObjectBase';

import Player from 'core/Player';

export default class PlayUserEventObject extends EventObjectBase {
	constructor(
		public readonly player: Player,
		public readonly type: string,
		public readonly data: any
	) {
		super();
	}
}
