import Engine from '../core/Engine';
import SimpleEventObject from './SimpleEventObject';

export default interface EngineEventObjectMap {
	fileloaded: SimpleEventObject<Engine>;
}
