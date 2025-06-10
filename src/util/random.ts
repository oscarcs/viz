/**
 * Generate a normally distributed random number using Box-Muller transform
 * @param {number} mean - The mean of the normal distribution.
 * @param {number} variance - The variance of the normal distribution.
 */
export function normalRandom(mean: number, variance: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + Math.sqrt(variance) * z0;
}