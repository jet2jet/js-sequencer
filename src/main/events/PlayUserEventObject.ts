import type PlayerBase from '../core/PlayerBase';
import EventObjectBase from './EventObjectBase';

export default class PlayUserEventObject extends EventObjectBase {
	constructor(
		public readonly player: PlayerBase,
		public readonly type: string,
		public readonly data: unknown
	) {
		super();
	}
}
