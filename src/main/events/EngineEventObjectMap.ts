
import SimpleEventObject from './SimpleEventObject';

import Engine from '../core/Engine';

export default interface EngineEventObjectMap {
	'fileloaded': SimpleEventObject<Engine>;
}
