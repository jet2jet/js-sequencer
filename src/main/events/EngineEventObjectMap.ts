import type Engine from '../core/Engine';
import type SimpleEventObject from './SimpleEventObject';

export default interface EngineEventObjectMap {
	fileloaded: SimpleEventObject<Engine>;
}
