// Inspect ISO BMFF track handlers, not text matches inside encoded video data.
export function mp4Tracks(buffer: ArrayBuffer): { video: boolean; audio: boolean } {
  const data = new DataView(buffer);
  const result = { video: false, audio: false };
  const type = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  function walk(start: number, end: number, depth: number) {
    if (depth > 5) throw new Error("VIDEO_CONTAINER_INVALID");
    for (let at = start; at < end;) {
      if (end - at < 8) throw new Error("VIDEO_CONTAINER_INVALID");
      let size = data.getUint32(at); let header = 8;
      if (size === 1) {
        if (end - at < 16) throw new Error("VIDEO_CONTAINER_INVALID");
        size = data.getUint32(at + 8) * 4294967296 + data.getUint32(at + 12); header = 16;
      }
      if (size === 0) size = end - at;
      if (!Number.isSafeInteger(size) || size < header || at + size > end) throw new Error("VIDEO_CONTAINER_INVALID");
      const name = type(at + 4);
      if (["moov", "trak", "mdia"].includes(name)) walk(at + header, at + size, depth + 1);
      if (name === "hdlr" && depth === 3 && size >= header + 12) {
        const handler = type(at + header + 8);
        result.video ||= handler === "vide";
        result.audio ||= handler === "soun";
      }
      at += size;
    }
  }
  walk(0, buffer.byteLength, 0);
  return result;
}
