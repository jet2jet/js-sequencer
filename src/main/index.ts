import * as Core from './core';
import * as Events from './events';
import * as TimeRational from './functions/timeRational';
import * as Objects from './objects';
import * as Types from './types';

declare global {
	var LIBRARY_VERSION: string;
}

const version = LIBRARY_VERSION;

export { Core, Events, Objects, TimeRational, Types, version };
