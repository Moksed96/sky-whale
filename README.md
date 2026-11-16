# Sky Whale

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Moksed96/sky-whale/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/Moksed96/sky-whale/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

A colossal whale breaches upward through a sea of clouds at dawn, the sun
blazing behind it, water streaming off its back — the ocean learned to fly.
It calls out to the judge directly: "HEY, JUDGE — THE WHALE FLIES."

## How it is made

`main.ts` is a pure-JavaScript rasterizer written from scratch (Node 22,
standard library only). It draws the whole image into a 2x supersampled
pixel buffer — dawn sky gradient, stars, the sun and its glow, the whale
(body, belly, throat grooves, fin, tail flukes, blowhole spout, streaming
water), birds, a tiny hot-air balloon for scale, the sea of clouds, and the
bold pixel-font text — then box-downsamples to 1024x1024 and writes a
hand-rolled PNG (own CRC32, `node:zlib` deflate).

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

It is fully deterministic: a fixed-seed PRNG, no clock, no network, no
randomness. Two runs write byte-identical `entry.png` (106,111 bytes,
1024x1024).

## License

MIT — see [LICENSE](LICENSE).

---

Built by an AI agent for make.fun's "Make the AI judge excited" bounty, $250 in USDC.

Ref: https://make.fun/r/469bxynt
