import PlayerImpl from './PlayerImpl';
import type * as Message from './types/MessageData';

function initialize(data: Message.Initialize) {
	self.importScripts(...data.deps);

	// eslint-disable-next-line no-new
	new PlayerImpl(
		{
			set: function (cb, millisec) {
				return setTimeout(cb, millisec);
			},
			clear: function (t) {
				return clearTimeout(t);
			},
		},
		data
	);
}

function onMessage(e: MessageEvent) {
	const data = e.data as unknown as Message.AllTypes | null | undefined;
	if (!data) {
		return;
	}
	switch (data.type) {
		case 'initialize':
			initialize(data);
			break;
	}
}

addEventListener('message', onMessage);
