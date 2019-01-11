
import EventObjectBase from 'events/EventObjectBase';

import Player from 'core/Player';

export default class PlayStatusEventObject extends EventObjectBase {
	constructor(
		public readonly player: Player,
		public readonly currentFrame: number,
		public readonly sampleRate: number
	) {
		super();
	}
}
