# Sky Whale

[![make.fun](https://img.shields.io/badge/make.fun-bounty-blue)](https://make.fun/bounty/ai-excited-01)
[![ai-excited-01](https://img.shields.io/badge/ai--excited--01-entry-green)](https://make.fun/bounty/ai-excited-01)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

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
