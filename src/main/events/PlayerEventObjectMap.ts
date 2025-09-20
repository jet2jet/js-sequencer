import type PlayEndNoteEventObject from './PlayEndNoteEventObject';
import type PlayerBaseEventObjectMap from './PlayerBaseEventObjectMap';
import type PlayLoopedEventObject from './PlayLoopedEventObject';
import type PlayQueueEventObject from './PlayQueueEventObject';

export default interface PlayerEventObjectMap extends PlayerBaseEventObjectMap {
	playqueue: PlayQueueEventObject;
	playendnote: PlayEndNoteEventObject;
	playallqueued: PlayQueueEventObject;
	playlooped: PlayLoopedEventObject;
}
