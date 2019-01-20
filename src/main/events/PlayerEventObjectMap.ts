
import PlayEndNoteEventObject from 'events/PlayEndNoteEventObject';
import PlayQueueEventObject from 'events/PlayQueueEventObject';

import PlayerBaseEventObjectMap from 'events/PlayerBaseEventObjectMap';

export default interface PlayerEventObjectMap extends PlayerBaseEventObjectMap {
	'playqueue': PlayQueueEventObject;
	'playendnote': PlayEndNoteEventObject;
	'playallqueued': PlayQueueEventObject;
}
