
import { RenderedResponse, Status, UserMarkerResponse } from './RenderMessageData';

/** @internal */
export interface Base {
	id?: number | null | undefined;
	type: string;
	data?: any;
}

/** @internal */
export type NoResponseMessageTypes = 'initialize' | 'config' | 'unload-sfont';

/** @internal */
export interface NoResponseMessage extends Base {
	id: number;
	type: NoResponseMessageTypes;
	data?: never;
}

/** @internal */
export interface LoadSoundfont extends Base {
	id: number;
	type: 'load-sfont';
	data: number;
}

/** @internal */
export interface Pause extends Base {
	id: number;
	type: 'pause';
	/** paused value */
	data: boolean;
}

/** @internal */
export interface Render extends Base {
	id?: never;
	type: 'render';
	data: [ArrayBuffer, ArrayBuffer];
}

/** @internal */
export interface Stop extends Base {
	id?: never;
	type: 'stop';
	/** playing id */
	data: number;
}

/** @internal */
export interface Reset extends Base {
	id?: never;
	type: 'reset';
	data?: never;
}

/** @internal */
export interface UserEvent extends Base {
	id?: never;
	type: 'user-event';
	data: string;
}

/** @internal */
export type AllTypes = NoResponseMessage | LoadSoundfont |
	Pause | Render | RenderedResponse | Status | UserMarkerResponse | Stop | Reset | UserEvent;

/** @internal */
export default AllTypes;
