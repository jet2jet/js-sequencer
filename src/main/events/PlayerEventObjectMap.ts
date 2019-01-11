
import PlayEndNoteEventObject from 'events/PlayEndNoteEventObject';
import PlayQueueEventObject from 'events/PlayQueueEventObject';
import PlayStatusEventObject from 'events/PlayStatusEventObject';
import SimpleEventObject from 'events/SimpleEventObject';

import Player from 'core/Player';

export default interface PlayerEventObjectMap {
	'reset': SimpleEventObject<Player>;
	'stopped': SimpleEventObject<Player>;
	'playqueue': PlayQueueEventObject;
	'playstatus': PlayStatusEventObject;
	'playendnote': PlayEndNoteEventObject;
	'playallqueued': PlayQueueEventObject;
}
