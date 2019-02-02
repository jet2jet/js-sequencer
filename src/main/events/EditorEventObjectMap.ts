
import MaxChangedEventObject from './MaxChangedEventObject';
import ResizeEventObject from './ResizeEventObject';
import ScrollEventObject from './ScrollEventObject';

export default interface EditorEventObjectMap {
	'scrollx': ScrollEventObject;
	'scrolly': ScrollEventObject;
	'resize': ResizeEventObject;
	'maxchanged': MaxChangedEventObject;
}
