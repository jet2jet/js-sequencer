import PlayEndNoteEventObject from './PlayEndNoteEventObject';
import PlayLoopedEventObject from './PlayLoopedEventObject';
import PlayQueueEventObject from './PlayQueueEventObject';

import PlayerBaseEventObjectMap from './PlayerBaseEventObjectMap';

export default interface PlayerEventObjectMap extends PlayerBaseEventObjectMap {
	playqueue: PlayQueueEventObject;
	playendnote: PlayEndNoteEventObject;
	playallqueued: PlayQueueEventObject;
	playlooped: PlayLoopedEventObject;
}
