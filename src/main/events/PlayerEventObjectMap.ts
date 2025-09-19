import PlayEndNoteEventObject from './PlayEndNoteEventObject';
import PlayerBaseEventObjectMap from './PlayerBaseEventObjectMap';
import PlayLoopedEventObject from './PlayLoopedEventObject';
import PlayQueueEventObject from './PlayQueueEventObject';

export default interface PlayerEventObjectMap extends PlayerBaseEventObjectMap {
	playqueue: PlayQueueEventObject;
	playendnote: PlayEndNoteEventObject;
	playallqueued: PlayQueueEventObject;
	playlooped: PlayLoopedEventObject;
}
