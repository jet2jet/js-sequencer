export function getItemFromArray<T>(arr: T[], item: T): number {
	return arr.indexOf(item);
}

export function removeItemFromArray<T>(arr: T[], item: T): boolean {
	const n = arr.indexOf(item);
	return n >= 0 ? (arr.splice(n, 1), true) : false;
}

export function gcd(m: number, n: number) {
	if (m < n) {
		const x = m;
		m = n;
		n = x;
	}
	while (n) {
		const r = m % n;
		m = n;
		n = r;
	}
	return m;
}

export function isUndefined(value: any): value is undefined {
	return typeof value === 'undefined';
}

export function isAudioAvailable() {
	return typeof AudioContext !== 'undefined';
}

export function loadBinaryFromFile(fileElemId: string | HTMLInputElement) {
	const f: HTMLInputElement =
		fileElemId && (fileElemId as HTMLInputElement).files
			? (fileElemId as HTMLInputElement)
			: (document.getElementById(
					fileElemId as string
			  ) as HTMLInputElement);
	if (!f || !f.files || !f.files.length) {
		return Promise.reject(new Error('Invalid argument'));
	}

	return new Promise<ArrayBuffer>((resolve, reject) => {
		const r = new FileReader();

		r.onloadend = () => {
			resolve(r.result! as ArrayBuffer);
		};
		r.onerror = (e) => {
			reject(e);
		};

		r.readAsArrayBuffer(f.files![0]);
	});
}
