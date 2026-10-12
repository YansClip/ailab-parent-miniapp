'use strict'

// This is a lab parser, not a production device identity or location validator.
function parseFrame(frame) {
  const text = frame.toString('utf8').trim()
  if (!text) return { kind: 'empty' }
  if (text === 'PING') return { kind: 'heartbeat' }
  // Older firmware may send a registration JSON before its coordinate frames.
  // Do not retain IMEI/ICCID or treat them as authentication credentials.
  if (text.startsWith('{')) {
    try {
      const value = JSON.parse(text)
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          (Object.hasOwn(value, 'imei') || Object.hasOwn(value, 'iccid')) &&
          !['longitude', 'latitude', 'lng', 'lat'].some(key => Object.hasOwn(value, key))) {
        return { kind: 'registration', identityVerified: false }
      }
    } catch (_) { /* Invalid JSON is rejected below; never echo its contents. */ }
    return { kind: 'invalid', code: 'UNSUPPORTED_JSON' }
  }
  // Decimal degrees only. No NMEA degree/minute inference, swapped-axis repair,
  // scientific notation, locale commas, or trailing garbage.
  const decimal = '([+-]?\\d{1,3}(?:\\.\\d{1,9})?)'
  const match = new RegExp('^' + decimal + '_' + decimal + '$').exec(text)
  if (!match) return { kind: 'invalid', code: 'INVALID_FORMAT' }
  const longitude = Number(match[1])
  const latitude = Number(match[2])
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
    return { kind: 'invalid', code: 'OUT_OF_RANGE' }
  }
  if (longitude === 0 && latitude === 0) return { kind: 'invalid', code: 'ZERO_FIX' }
  return { kind: 'location', longitude, latitude }
}

class FrameDecoder {
  constructor({ mode = 'line', maxFrameBytes = 512, authLine = false, onFrame, onError }) {
    this.mode = mode
    this.maxFrameBytes = maxFrameBytes
    this.onFrame = onFrame
    this.onError = onError
    this.buffer = Buffer.alloc(0)
    this.failed = false
    this.fixedStage = authLine ? 'auth' : 'initial'
  }

  push(chunk) {
    if (this.failed) return
    if (this.mode === 'fixed17') return this.pushFixed(chunk)
    // Process one delimiter at a time. A large coalesced chunk may contain many
    // small valid frames; limits apply to each frame, not the entire TCP read.
    let offset = 0
    while (offset < chunk.length && !this.failed) {
      const newline = chunk.indexOf(10, offset)
      const end = newline < 0 ? chunk.length : newline
      const part = chunk.subarray(offset, end)
      if (this.buffer.length + part.length > this.maxFrameBytes) {
        this.failed = true
        this.buffer = Buffer.alloc(0)
        this.onError('FRAME_TOO_LARGE')
        return
      }
      this.buffer = Buffer.concat([this.buffer, part])
      if (newline < 0) return
      const frame = this.buffer
      this.buffer = Buffer.alloc(0)
      this.onFrame(frame, 'newline')
      offset = newline + 1
    }
  }

  fail(code) {
    this.failed = true
    this.buffer = Buffer.alloc(0)
    this.onError(code)
  }

  pushFixed(chunk) {
    // Byte-by-byte assembly keeps memory bounded even for coalesced TCP reads.
    // An optional initial JSON object has its own structural boundary; its
    // length, string contents and TCP packet boundaries are NOT coordinate sizes.
    for (const byte of chunk) {
      if (this.failed) break
      if (!this.buffer.length && this.fixedStage !== 'auth' && (byte === 13 || byte === 10)) continue
      this.buffer = Buffer.concat([this.buffer, Buffer.from([byte])])
      if (this.buffer.length > this.maxFrameBytes) return this.fail('FRAME_TOO_LARGE')
      if (this.fixedStage === 'auth') {
        if (byte !== 10) continue
        const frame = this.buffer.subarray(0, -1)
        this.buffer = Buffer.alloc(0)
        this.fixedStage = 'initial'
        this.onFrame(frame, 'newline')
        continue
      }
      if (this.fixedStage === 'initial') this.fixedStage = byte === 123 ? 'registration' : 'coordinates'
      if (this.fixedStage === 'registration') {
        let depth = 0; let quoted = false; let escaped = false
        for (const c of this.buffer) {
          if (quoted) {
            if (escaped) escaped = false
            else if (c === 92) escaped = true
            else if (c === 34) quoted = false
          } else if (c === 34) quoted = true
          else if (c === 123) depth++
          else if (c === 125) depth--
        }
        if (depth !== 0 || quoted) continue
        const frame = this.buffer
        if (parseFrame(frame).kind !== 'registration') return this.fail('UNSUPPORTED_JSON')
        this.buffer = Buffer.alloc(0)
        this.fixedStage = 'coordinates'
        this.onFrame(frame, 'json-object')
        continue
      }
      // Contract: DDD.dddd_DD.ddddd, unsigned decimal degrees, exactly 17 ASCII
      // bytes. Reject a wrong byte immediately; never scan forward to guess alignment.
      const index = this.buffer.length - 1
      const expected = index === 3 || index === 11 ? 46 : index === 8 ? 95 : null
      if (expected === null ? byte < 48 || byte > 57 : byte !== expected) return this.fail('FIXED_FORMAT')
      if (this.buffer.length === 17) {
        const frame = this.buffer
        this.buffer = Buffer.alloc(0)
        this.onFrame(frame, 'fixed17')
      }
    }
  }

  flushProbe() {
    if (this.mode !== 'idle-probe' || this.failed || !this.buffer.length) return
    const frame = this.buffer
    this.buffer = Buffer.alloc(0)
    this.onFrame(frame, 'idle-gap')
  }

  get pendingBytes() { return this.buffer.length }
  clear() { this.buffer = Buffer.alloc(0) }
}

module.exports = { parseFrame, FrameDecoder }
