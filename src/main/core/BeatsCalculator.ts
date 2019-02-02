
import { gcd } from '../functions';

/** @internal */
export default class BeatsCalculator {
	public posNumerator: number = 0;
	public posDenominator: number = 4;
	public beatsNumerator: number = 4;
	public beatsDenominator: number = 4;
	public beatsDenPerGcd: number = 1; // beatsDenominator / gcd

	public incrementPosition(delta: number) {
		this.posNumerator += delta * this.beatsDenPerGcd;
	}
	public changeTimeSignature(beatsNumerator: number, beatsDenominator: number) {
		const g = gcd(this.posDenominator, beatsDenominator);
		const q = beatsDenominator / g;
		// this.beatsDenPerGcd = this.posDenominator / g;
		this.beatsDenPerGcd = q;
		this.posNumerator *= q;
		this.posDenominator *= q;
		this.beatsNumerator = beatsNumerator;
		this.beatsDenominator = beatsDenominator;
	}
}
