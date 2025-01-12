/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2019
 */

'use strict';

const port = process.env.APP_PORT || 3217;

require('../../../../')();

const Mali = require('mali');
const pinoLogger = require('pino')();
const express = require('express');
const morgan = require('morgan');
const path = require('path');

const expressApp = express();

const logPrefix = `GRPC Mali Server (${process.pid}):\t`;

async function MakeUnaryCall(ctx) {
  pinoLogger.warn('/unary-call');
  ctx.res = { message: 'received: request' };
}

async function StartServerSideStreaming() {
  throw new Error('Not implemented');
}

async function StartClientSideStreaming() {
  throw new Error('Not implemented');
}

async function StartBidiStreaming() {
  throw new Error('Not implemented');
}

const maliApp = new Mali(path.join(__dirname, 'protos', 'test.proto'));
maliApp.use({
  MakeUnaryCall,
  StartServerSideStreaming,
  StartClientSideStreaming,
  StartBidiStreaming
});
maliApp.start('127.0.0.1:50051');

if (process.env.WITH_STDOUT) {
  expressApp.use(morgan(`${logPrefix}:method :url :status`));
}

expressApp.get('/', (req, res) => {
  res.send('OK');
});

expressApp.listen(port, () => {
  log(`Listening on port: ${port}`);
});

function log() {
  const args = Array.prototype.slice.call(arguments);
  args[0] = `GRPC Server (${process.pid}):\t${args[0]}`;
  // eslint-disable-next-line no-console
  console.log.apply(console, args);
}
