import { encodeBase64 } from "jsr:@std/encoding/base64";
const bytes = new Uint8Array([72, 101, 108, 108, 111]);
console.log(encodeBase64(bytes));
