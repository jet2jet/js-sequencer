import type PlayerBase from '../core/PlayerBase';
import type PlayStatusEventObject from './PlayStatusEventObject';
import type PlayUserEventObject from './PlayUserEventObject';
import type PlayUserMarkerEventObject from './PlayUserMarkerEventObject';
import type SimpleEventObject from './SimpleEventObject';

export default interface PlayerBaseEventObjectMap {
	prepare: SimpleEventObject<PlayerBase>;
	start: SimpleEventObject<PlayerBase>;
	reset: SimpleEventObject<PlayerBase>;
	stopped: SimpleEventObject<PlayerBase>;
	playqueued: PlayStatusEventObject;
	playstatus: PlayStatusEventObject;
	playuserevent: PlayUserEventObject;
	/**
	 * similar to 'playuserevent', but this event is occurred when the marker is to be 'rendered',
	 * while 'playuserevent' event is occurred when the user-defined event is to be 'processed'.
	 */
	playusermarkerevent: PlayUserMarkerEventObject;
}
