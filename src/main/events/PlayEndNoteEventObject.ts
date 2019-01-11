
import EventObjectBase from 'events/EventObjectBase';

import Player from 'core/Player';

export default class PlayEndNoteEventObject extends EventObjectBase {
	constructor(public readonly player: Player, public readonly playing: number, public readonly totalPlayed: number) {
		super();
	}
}
