import PlayerBase from '../core/PlayerBase';
import PlayStatusEventObject from './PlayStatusEventObject';
import PlayUserEventObject from './PlayUserEventObject';
import PlayUserMarkerEventObject from './PlayUserMarkerEventObject';
import SimpleEventObject from './SimpleEventObject';

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
