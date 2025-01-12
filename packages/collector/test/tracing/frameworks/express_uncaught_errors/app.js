/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2018
 */

/* eslint-disable no-console */

'use strict';

require('../../../../')();

const bodyParser = require('body-parser');
const express = require('express');
const morgan = require('morgan');

const app = express();
const logPrefix = `Express uncaughtErrors App (${process.pid}):\t`;

if (process.env.WITH_STDOUT) {
  app.use(morgan(`${logPrefix}:method :url :status`));
}

app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.sendStatus(200);
});

// eslint-disable-next-line
app.get('/customErrorHandler', (req, res) => {
  throw new Error('To be caught by custom error handler');
});

// eslint-disable-next-line
app.use((err, req, res, next) => {
  res.sendStatus(400);
});

// eslint-disable-next-line
app.get('/defaultErrorHandler', (req, res) => {
  throw new Error('To be caught by default error handler');
});

app.listen(process.env.APP_PORT, () => {
  log(`Listening on port: ${process.env.APP_PORT}`);
});

function log() {
  const args = Array.prototype.slice.call(arguments);
  args[0] = logPrefix + args[0];
  console.log.apply(console, args);
}
