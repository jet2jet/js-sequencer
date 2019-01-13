
import { RenderedResponse, Status } from 'types/RenderMessageData';

/** @internal */
export interface Base {
	id?: number | null | undefined;
	type: string;
	data?: any;
}

/** @internal */
export type NoResponseMessageTypes = 'initialize' | 'config' | 'unload-sfont';
/** @internal */
export type AsyncMessageTypes = 'stop' | 'reset';

/** @internal */
export interface NoResponseMessage extends Base {
	id: number;
	type: NoResponseMessageTypes;
	data?: never;
}

/** @internal */
export interface AsyncMessage extends Base {
	id?: never;
	type: AsyncMessageTypes;
	data?: never;
}

/** @internal */
export interface LoadSoundfont extends Base {
	id: number;
	type: 'load-sfont';
	data: number;
}

/** @internal */
export interface Render extends Base {
	id?: never;
	type: 'render';
	data: [ArrayBuffer, ArrayBuffer];
}

/** @internal */
export interface Reset extends Base {
	id?: never;
	type: 'reset';
}

/** @internal */
export interface UserEvent extends Base {
	id?: never;
	type: 'user-event';
	data: string;
}

/** @internal */
export type AllTypes = NoResponseMessage | AsyncMessage | LoadSoundfont |
	Render | RenderedResponse | Status | Reset | UserEvent;

/** @internal */
export default AllTypes;
