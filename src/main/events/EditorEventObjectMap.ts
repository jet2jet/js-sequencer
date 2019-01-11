
import MaxChangedEventObject from 'events/MaxChangedEventObject';
import ResizeEventObject from 'events/ResizeEventObject';
import ScrollEventObject from 'events/ScrollEventObject';

export default interface EditorEventObjectMap {
	'scrollx': ScrollEventObject;
	'scrolly': ScrollEventObject;
	'resize': ResizeEventObject;
	'maxchanged': MaxChangedEventObject;
}
