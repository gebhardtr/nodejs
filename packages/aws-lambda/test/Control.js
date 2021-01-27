/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2020
 */

'use strict';

const { fork } = require('child_process');
const {
  assert: { fail }
} = require('chai');

const retry = require('../../serverless/test/util/retry');
const config = require('../../serverless/test/config');
const AbstractServerlessControl = require('../../serverless/test/util/AbstractServerlessControl');

function Control(opts) {
  AbstractServerlessControl.call(this, opts);
  this.backendPort = this.opts.backendPort || 8443;
  this.backendBaseUrl = this.opts.backendBaseUrl || `https://localhost:${this.backendPort}/serverless`;
  this.downstreamDummyPort = this.opts.downstreamDummyPort || 3456;
  this.downstreamDummyUrl = this.opts.downstreamDummyUrl || `http://localhost:${this.downstreamDummyPort}`;
  this.proxyPort = this.opts.proxyPort || 3128;
  this.proxyUrl = this.opts.proxyUrl || `http://localhost:${this.proxyPort}`;
}

Control.prototype = Object.create(AbstractServerlessControl.prototype);

Control.prototype.reset = function reset() {
  AbstractServerlessControl.prototype.reset.call(this);
  this.messagesFromFaasRuntime = [];
  this.lambdaErrors = [];
  this.lambdaResults = [];
  this.expectedHandlerRuns = 0;
  this.startedAt = 0;
};

Control.prototype.registerTestHooks = function registerTestHooks() {
  AbstractServerlessControl.prototype.registerTestHooks.call(this);
  beforeEach(() => {
    if (!this.opts.faasRuntimePath) {
      fail('opts.faasRuntimePath is unspecified.');
    } else if (!this.opts.handlerDefinitionPath) {
      fail('opts.handlerDefinitionPath is unspecified.');
    }
  });
  return this;
};

Control.prototype.startMonitoredProcess = function startMonitoredProcess() {
  this.faasRuntime = fork(this.opts.faasRuntimePath, {
    stdio: config.getAppStdio(),
    env: Object.assign(
      {
        HANDLER_DEFINITION_PATH: this.opts.handlerDefinitionPath,
        DOWNSTREAM_DUMMY_URL: this.downstreamDummyUrl,
        INSTANA_DISABLE_CA_CHECK: true,
        WAIT_FOR_MESSAGE: true
      },
      process.env,
      this.opts.env
    )
  });

  this.faasRuntime.on('message', message => {
    if (message.type === 'lambda-result') {
      if (message.error) {
        this.lambdaErrors.push(message.payload);
      } else {
        this.lambdaResults.push(message.payload);
      }
    } else {
      this.messagesFromFaasRuntime.push(message);
    }
  });
};

Control.prototype.hasMonitoredProcessStarted = function hasMonitoredProcessStarted() {
  return this.messagesFromFaasRuntime.indexOf('runtime: started') >= 0;
};

Control.prototype.runHandler = function runHandler() {
  this.startedAt = Date.now();
  this.faasRuntime.send('run-handler');
  this.expectedHandlerRuns++;
  return this.waitUntilHandlerHasRun();
};

Control.prototype.waitUntilHandlerHasRun = function waitUntilHandlerHasRun() {
  return retry(() => this.hasHandlerRunPromise(), this.opts.timeout / 2);
};

Control.prototype.hasHandlerRunPromise = function hasHandlerRunPromise() {
  if (this.hasHandlerRun()) {
    return Promise.resolve();
  } else {
    return Promise.reject(
      new Error(
        `Expected the handler to have been running ${this.expectedHandlerRuns} time(s), ` +
          `but it ran only ${this.countHandlerRuns()} time(s).`
      )
    );
  }
};

Control.prototype.hasHandlerRun = function hasHandlerRun() {
  return this.countHandlerRuns() >= this.expectedHandlerRuns;
};

Control.prototype.countHandlerRuns = function countHandlerRuns() {
  return this.lambdaErrors.length + this.lambdaResults.length;
};

Control.prototype.hasMonitoredProcessTerminated = function hasMonitoredProcessTerminated() {
  return this.messagesFromFaasRuntime.indexOf('runtime: terminating') >= 0;
};

Control.prototype.killMonitoredProcess = function killMonitoredProcess() {
  if (!this.hasMonitoredProcessTerminated()) {
    return this.killChildProcess(this.faasRuntime);
  }
  return Promise.resolve();
};

Control.prototype.getLambdaResults = function getLambdaResults() {
  return this.lambdaResults;
};

Control.prototype.getLambdaErrors = function getLambdaErrors() {
  return this.lambdaErrors;
};

module.exports = Control;
