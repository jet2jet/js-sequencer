import type Player from '../core/Player';
import EventObjectBase from './EventObjectBase';

export default class PlayEndNoteEventObject extends EventObjectBase {
	constructor(
		public readonly player: Player,
		public readonly playing: number,
		public readonly totalPlayed: number
	) {
		super();
	}
}
