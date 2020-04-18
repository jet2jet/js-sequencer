export const enum Defaults {
	PrerenderSeconds = 2,
	MaxQueueSeconds = 15,
}

export default interface Options {
	prerenderSeconds?: number;
	maxQueueSeconds?: number;
}
