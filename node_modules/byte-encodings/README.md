<!-- deno-fmt-ignore-file -->

byte-encodings
==============

[![npm][npm badge]][npm]
[![GitHub Actions][GitHub Actions badge]][GitHub Actions]

This package is a port of Deno's [@std/encoding], which provides utilities for
encoding and decoding common formats like:

 -  ascii85 (Adobe, btoa, RFC 1924, Z85)
 -  base32
 -  base58
 -  base64
 -  base64url
 -  hex
 -  varint

Note that every encoder takes [`Uint8Array`] or [`ArrayBuffer`], and every decoder
returns [`Uint8Array`].

Here's the overview of the APIs that this package offers:

~~~~ typescript
import { encodeAscii85,    decodeAscii85   } from "byte-encodings/ascii85"
import { encodeBase32,     decodeBase32    } from "byte-encodings/base32"
import { encodeBase58,     decodeBase58    } from "byte-encodings/base58"
import { encodeBase64,     decodeBase64    } from "byte-encodings/base64"
import { encodeBase64Url,  decodeBase64Url } from "byte-encodings/base64url"
import { encodeHex,        decodeHex       } from "byte-encodings/hex"
import { encodeVarint, decodeVarint, decodeVarint32 } from "byte-encodings/varint"
~~~~

For your information, this package offers these *unstable* modules too:

 -  `byte-encodings/unstable-base32`
 -  `byte-encodings/unstable-base32-stream`
 -  `byte-encodings/unstable-base64`
 -  `byte-encodings/unstable-base64-stream`
 -  `byte-encodings/unstable-hex`
 -  `byte-encodings/unstable-hex-stream`

Since the APIs are identical to *@std/encoding*, for the complete API references,
see the [docs on *@std/encoding*'s JSR][@std/encoding].

[npm]: https://www.npmjs.com/package/byte-encodings
[npm badge]: https://img.shields.io/npm/v/byte-encodings?logo=npm
[GitHub Actions]: https://github.com/dahlia/byte-encodings/actions/workflows/main.yaml
[GitHub Actions badge]: https://github.com/dahlia/byte-encodings/actions/workflows/main.yaml/badge.svg
[@std/encoding]: https://jsr.io/@std/encoding
[`Uint8Array`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array
[`ArrayBuffer`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer
