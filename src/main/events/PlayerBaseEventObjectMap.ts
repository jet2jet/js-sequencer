
import PlayStatusEventObject from 'events/PlayStatusEventObject';
import PlayUserEventObject from 'events/PlayUserEventObject';
import SimpleEventObject from 'events/SimpleEventObject';

import PlayerBase from 'core/PlayerBase';

export default interface PlayerBaseEventObjectMap {
	'reset': SimpleEventObject<PlayerBase>;
	'stopped': SimpleEventObject<PlayerBase>;
	'playstatus': PlayStatusEventObject;
	'playuserevent': PlayUserEventObject;
}
