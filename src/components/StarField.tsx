import React from 'react';

// Deterministic PRNG (mulberry32) so the sky stays stable across renders.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mostly white with occasional indigo, ice-blue, and warm-gold stars.
const STAR_TINTS = ['255,255,255', '255,255,255', '255,255,255', '199,210,254', '186,230,253', '254,240,138'];

function makeStars(count: number, seed: number): string {
  const rand = mulberry32(seed);
  const shadows: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() * 100).toFixed(2);
    const y = (rand() * 100).toFixed(2);
    const tint = STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)];
    const alpha = (0.35 + rand() * 0.65).toFixed(2);
    shadows.push(`${x}vw ${y}vh 0 rgba(${tint},${alpha})`);
  }
  return shadows.join(',');
}

// Three depth layers, computed once at module load.
const SMALL_STARS = makeStars(150, 11);
const MEDIUM_STARS = makeStars(60, 22);
const LARGE_STARS = makeStars(22, 33);

export default function StarField() {
  return (
    <div aria-hidden className="starfield">
      <div className="star-layer star-layer-sm" style={{ boxShadow: SMALL_STARS }} />
      <div className="star-layer star-layer-md" style={{ boxShadow: MEDIUM_STARS }} />
      <div className="star-layer star-layer-lg" style={{ boxShadow: LARGE_STARS }} />
    </div>
  );
}
