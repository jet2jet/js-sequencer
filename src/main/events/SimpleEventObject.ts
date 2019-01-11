
import EventObjectBase from 'events/EventObjectBase';

export default class SimpleEventObject<T> extends EventObjectBase {
	constructor(public readonly target: T) {
		super();
	}
}
