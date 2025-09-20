export default interface Channel {
	bank: number | null;
	preset: number | null;
	volume: number | null;
	nrpnMsb: number | null;
	nrpnLsb: number | null;
	rpnMsb: number | null;
	rpnLsb: number | null;
	rpnValue: number | null; // for RPN: 0～0x3FFF, for NRPN: 0x4000～0x7FFF
	isHolding: boolean;
	pitchRange: number | null;
	pitchMIDIValue: number | null;
}

export function makeChannel(isDrum: boolean): Channel {
	return {
		bank: isDrum ? 128 : 0,
		preset: 0,
		volume: 100,
		nrpnMsb: null,
		nrpnLsb: null,
		rpnMsb: null,
		rpnLsb: null,
		rpnValue: null, // for RPN: 0～0x3FFF, for NRPN: 0x4000～0x7FFF
		isHolding: false,
		pitchRange: 2,
		pitchMIDIValue: 8192,
	};
}
