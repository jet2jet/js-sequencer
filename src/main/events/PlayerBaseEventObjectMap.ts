
import PlayStatusEventObject from './PlayStatusEventObject';
import PlayUserEventObject from './PlayUserEventObject';
import SimpleEventObject from './SimpleEventObject';

import PlayerBase from 'core/PlayerBase';

export default interface PlayerBaseEventObjectMap {
	'reset': SimpleEventObject<PlayerBase>;
	'stopped': SimpleEventObject<PlayerBase>;
	'playstatus': PlayStatusEventObject;
	'playuserevent': PlayUserEventObject;
}
