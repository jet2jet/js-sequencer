import PlayerImpl from './PlayerImpl';
import * as Message from './types/MessageData';

function initialize(data: Message.Initialize) {
	self.importScripts(...data.deps);

	// eslint-disable-next-line no-new
	new PlayerImpl(data);
}

function onMessage(e: MessageEvent) {
	const data: Message.AllTypes = e.data;
	switch (data.type) {
		case 'initialize':
			initialize(data);
			break;
	}
}

addEventListener('message', onMessage);
