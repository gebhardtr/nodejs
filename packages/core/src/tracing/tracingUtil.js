'use strict';

var crypto = require('crypto');
var StringDecoder = require('string_decoder').StringDecoder;
var hexDecoder = new StringDecoder('hex');

var stackTrace = require('../util/stackTrace');

const ZERO_PADDING = [
  '000000000000000',
  '00000000000000',
  '0000000000000',
  '000000000000',
  '00000000000',
  '0000000000',
  '000000000',
  '00000000',
  '0000000',
  '000000',
  '00000',
  '0000',
  '000',
  '00',
  '0',
  '0'
];

var stackTraceLength = 10;

exports.init = function(config) {
  stackTraceLength = config.tracing.stackTraceLength;
};

exports.getStackTrace = function getStackTrace(referenceFunction) {
  return stackTrace.captureStackTrace(stackTraceLength, referenceFunction);
};

exports.generateRandomTraceId = function generateRandomTraceId() {
  // Note: As soon as all Instana tracers support 128 bit trace IDs we can generate a string of length 32 here.
  return exports.generateRandomId(16);
};

exports.generateRandomSpanId = function generateRandomSpanId() {
  return exports.generateRandomId(16);
};

exports.generateRandomId = function(length) {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
};

/**
 * - convert one BigInt to a 64 bit hexString: signedBigIntToUnsignedHexString(bigInt)
 * - convert two BigInts to one 128 bit hexString: signedBigIntToUnsignedHexString(hi, lo)
 */
exports.signedBigIntToUnsignedHexString = function signedBigIntToUnsignedHexString(hi, lo) {
  if (lo == null) {
    lo = hi;
    hi = null;
  }
  if (hi === 0n || hi == null) {
    return toUnsignedHexString(lo);
  }
  return toUnsignedHexString(hi) + toUnsignedHexString(lo);
};

function toUnsignedHexString(bigInt) {
  // see also: https://docs.oracle.com/en/java/javase/13/docs/api/java.base/java/lang/Long.html#toHexString(long)
  if (bigInt < 0n) {
    bigInt += 18446744073709551616n; // 2^64
  }
  const hexString = bigInt.toString(16);
  if (hexString.length < 16) {
    return ZERO_PADDING[hexString.length - 1] + hexString;
  }
  return hexString;
}

exports.readTraceContextFromBuffer = function readTraceContextFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Not a buffer: ' + buffer);
  }
  if (buffer.length !== 24) {
    throw new Error('Only buffers of length 24 are supported: ' + buffer);
  }
  // Check if the first 8 bytes are all zeroes:
  // (Beginning with Node.js 12, this check could be simply `buffer.readBigInt64BE(0) !== 0n) {`.)
  if (buffer.readInt32BE(0) !== 0 || buffer.readInt32BE(4) !== 0) {
    return { t: readHexFromBuffer(buffer, 0, 16), s: readHexFromBuffer(buffer, 16, 8) };
  } else {
    return { t: readHexFromBuffer(buffer, 8, 8), s: readHexFromBuffer(buffer, 16, 8) };
  }
};

function readHexFromBuffer(buffer, offset, length) {
  return hexDecoder.write(buffer.slice(offset, offset + length));
}

exports.unsignedHexStringToSignedBigInt = function unsignedHexStringToSignedBigInt(hexString) {
  if (hexString.length <= 16) {
    return toBigInt(hexString);
  } else {
    return toBigInt(hexString.substring(0, 16));
  }
};

exports.unsignedHexStringToLoTraceIdBigInt = function unsignedHexStringToLoTraceIdBigInt(hexString) {
  return toBigInt(hexString.substring(16, 32));
};

function toBigInt(hexString) {
  var bigInt = BigInt(`0x${hexString}`);
  if (bigInt >= 9223372036854775808n) {
    bigInt -= 18446744073709551616n; // 2^64
  }
  return bigInt;
}

exports.unsignedHexStringToBuffer = function unsignedHexStringToBuffer(hexString, buffer, offsetFromRight) {
  var offset;
  if (buffer && offsetFromRight != null) {
    offset = buffer.length - hexString.length / 2 - offsetFromRight;
  } else {
    offset = 0;
  }

  if (hexString.length === 16) {
    buffer = buffer || Buffer.alloc(8);
  } else if (hexString.length === 32) {
    buffer = buffer || Buffer.alloc(16);
  } else {
    throw new Error('Only supported hex string lengths are 16 and 32, got: ' + hexString);
  }
  writeHexToBuffer(hexString, buffer, offset);
  return buffer;
};

exports.unsignedHexStringsToBuffer = function unsignedHexStringsToBuffer(traceId, spanId) {
  var buffer = Buffer.alloc(24);
  exports.unsignedHexStringToBuffer(traceId, buffer, 8);
  exports.unsignedHexStringToBuffer(spanId, buffer, 0);
  return buffer;
};

/**
 * Writes characters from a hex string directly to a buffer, without converting the hex string to a BigInt beforehand.
 * The string hexString must only contain the characters [0-9a-f].
 */
function writeHexToBuffer(hexString, buffer, offset) {
  buffer.hexWrite(hexString, offset, hexString.length / 2);
}

exports.renderTraceContextToBuffer = function renderTraceContextToBuffer(span) {
  return exports.unsignedHexStringsToBuffer(span.t, span.s);
};

exports.getErrorDetails = function getErrorDetails(err) {
  if (err == null) {
    return undefined;
  }
  return String(err.stack || err.message || err).substring(0, 500);
};

exports.shortenDatabaseStatement = function shortenDatabaseStatement(stmt) {
  if (stmt == null || typeof stmt !== 'string') {
    return undefined;
  }

  return stmt.substring(0, 4000);
};

exports.readAttribCaseInsensitive = function readAttribCaseInsensitive(object, key) {
  if (!object || typeof object !== 'object' || typeof key !== 'string') {
    return null;
  }
  var keyUpper = key.toUpperCase();
  var allKeys = Object.keys(object);
  for (var i = 0; i < allKeys.length; i++) {
    if (typeof allKeys[i] === 'string' && allKeys[i].toUpperCase() === keyUpper) {
      return object[allKeys[i]];
    }
  }
  return null;
};
