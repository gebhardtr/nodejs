/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2019
 */

'use strict';

const expect = require('chai').expect;
const path = require('path');
const constants = require('@instana/core').tracing.constants;

const Control = require('../Control');
const delay = require('../../../core/test/test_util/delay');
const expectExactlyOneMatching = require('../../../core/test/test_util/expectExactlyOneMatching');
const config = require('../../../serverless/test/config');
const retry = require('../../../serverless/test/util/retry');

const functionName = 'functionName';
const unqualifiedArn = `arn:aws:lambda:us-east-2:410797082306:function:${functionName}`;
const version = '$LATEST';
const qualifiedArn = `${unqualifiedArn}:${version}`;

const backendPort = 8443;
const backendBaseUrl = `https://localhost:${backendPort}/serverless`;
const downstreamDummyPort = 3456;
const downstreamDummyUrl = `http://localhost:${downstreamDummyPort}/`;
const instanaAgentKey = 'aws-lambda-dummy-key';

function prelude(opts) {
  this.timeout(config.getTestTimeout());
  this.slow(config.getTestTimeout() / 4);

  const env = {};
  if (opts.error) {
    env.LAMDBA_ERROR = opts.error;
  }
  if (opts.instanaEndpointUrl) {
    env.INSTANA_ENDPOINT_URL = opts.instanaEndpointUrl;
  }
  if (opts.instanaAgentKey) {
    env.INSTANA_AGENT_KEY = opts.instanaAgentKey;
  }
  if (opts.withConfig) {
    env.WITH_CONFIG = 'true';
  }

  const control = new Control({
    faasRuntimePath: path.join(__dirname, '../runtime_mock'),
    handlerDefinitionPath: opts.handlerDefinitionPath,
    startBackend: true,
    backendPort,
    backendBaseUrl,
    downstreamDummyUrl,
    env
  });
  control.registerTestHooks();
  return control;
}

describe('Using the API', () => {
  const handlerDefinitionPath = path.join(__dirname, './lambda');

  describe('when everything is peachy', function () {
    // - INSTANA_ENDPOINT_URL is configured
    // - INSTANA_AGENT_KEY is configured
    // - back end is reachable
    // - lambda function ends with success
    const control = prelude.bind(this)({
      handlerDefinitionPath,
      instanaEndpointUrl: backendBaseUrl,
      instanaAgentKey
    });

    it('must capture metrics and spans', () => verify(control, false, true));
  });

  describe('when lambda function yields an error', function () {
    // - INSTANA_ENDPOINT_URL is configured
    // - back end is reachable
    // - lambda function ends with an error
    const control = prelude.bind(this)({
      handlerDefinitionPath,
      instanaEndpointUrl: backendBaseUrl,
      instanaAgentKey,
      error: true
    });

    it('must capture metrics and spans', () => verify(control, true, true));
  });

  describe('with config', function () {
    // - INSTANA_ENDPOINT_URL is configured
    // - back end is reachable
    // - client provides a config object
    // - lambda function ends with success
    const control = prelude.bind(this)({
      handlerDefinitionPath,
      instanaEndpointUrl: backendBaseUrl,
      instanaAgentKey,
      withConfig: true
    });

    it('must capture metrics and spans', () => verify(control, false, true));
  });

  describe('with config, when lambda function yields an error', function () {
    // - INSTANA_ENDPOINT_URL is configured
    // - back end is reachable
    // - client provides a config object
    // - lambda function ends with an error
    const control = prelude.bind(this)({
      handlerDefinitionPath,
      instanaEndpointUrl: backendBaseUrl,
      instanaAgentKey,
      withConfig: true,
      error: true
    });

    it('must capture metrics and spans', () => verify(control, true, true));
  });

  describe('when INSTANA_ENDPOINT_URL is missing', function () {
    // - INSTANA_ENDPOINT_URL is missing
    // - lambda function ends with success
    const control = prelude.bind(this)({
      handlerDefinitionPath,
      instanaAgentKey
    });

    it('must ignore the missing URL gracefully', () => verify(control, false, false));
  });

  describe('when INSTANA_ENDPOINT_URL is missing and the lambda function yields an error', function () {
    // - INSTANA_ENDPOINT_URL is missing
    // - lambda function ends with an error
    const control = prelude.bind(this)({
      handlerDefinitionPath,
      instanaAgentKey,
      error: true
    });

    it('must ignore the missing URL gracefully', () => verify(control, true, false));
  });

  describe('with config, when INSTANA_ENDPOINT_URL is missing', function () {
    // - INSTANA_ENDPOINT_URL is missing
    // - client provides a config
    // - lambda function ends with success
    const control = prelude.bind(this)({
      handlerDefinitionPath,
      instanaAgentKey,
      withConfig: true
    });

    it('must ignore the missing URL gracefully', () => verify(control, false, false));
  });

  function verify(control, error, expectSpansAndMetrics) {
    return control.runHandler().then(() => {
      verifyResponse(control, error, expectSpansAndMetrics);

      if (expectSpansAndMetrics) {
        return retry(() => getAndVerifySpans(control, error).then(() => getAndVerifyMetrics(control)));
      } else {
        return delay(1000)
          .then(() => verifyNoSpans(control))
          .then(() => verifyNoMetrics(control));
      }
    });
  }

  function verifyResponse(control, error, expectSpansAndMetrics) {
    /* eslint-disable no-console */
    if (error) {
      expect(control.getLambdaErrors().length).to.equal(1);
      expect(control.getLambdaResults()).to.be.empty;
      const lambdaError = control.getLambdaErrors()[0];
      expect(lambdaError).to.exist;
      expect(lambdaError.message).to.equal('Boom!');
      // other error cases like 'http' are checked in verifyLambdaEntry
    } else {
      if (control.getLambdaErrors() && control.getLambdaErrors().length > 0) {
        console.log('Unexpected Errors:');
        console.log(JSON.stringify(control.getLambdaErrors()));
      }
      expect(control.getLambdaErrors()).to.be.empty;
      expect(control.getLambdaResults().length).to.equal(1);
      const result = control.getLambdaResults()[0];
      expect(result).to.exist;
      const body = result.body;
      expect(body.message).to.equal('Stan says hi!');

      expect(body.logs).to.be.an('object');
      expect(body.currentSpan).to.be.an('object');

      if (expectSpansAndMetrics) {
        // eslint-disable-next-line
        console.log('comparing expected debug logs to:', body.logs.debug);
        expect(body.logs.debug).to.include('Sending data to Instana (/bundle).');
        expect(body.logs.info).to.be.empty;
        expect(body.logs.warn).to.deep.equal([
          'INSTANA_DISABLE_CA_CHECK is set, which means that the server certificate will not be verified against the ' +
            'list of known CAs. This makes your lambda vulnerable to MITM attacks when connecting to Instana. ' +
            'This setting should never be used in production, unless you use our on-premises product and are unable ' +
            'to operate the Instana back end with a certificate with a known root CA.'
        ]);
        expect(body.logs.error).to.be.empty;
        expect(body.currentSpanConstructor).to.equal('SpanHandle');
        expect(body.currentSpan).to.exist;
        expect(body.currentSpan.span).to.exist;
        expect(body.currentSpan.span.n).to.equal('aws.lambda.entry');
      } else {
        expect(body.currentSpanConstructor).to.equal('NoopSpanHandle');
        expect(body.currentSpan).to.deep.equal({});
      }
    }
  }

  function verifyNoSpans(control) {
    return control.getSpans().then(spans => {
      expect(spans).to.be.empty;
    });
  }

  function getAndVerifySpans(control, error) {
    return control.getSpans().then(spans => verifySpans(spans, error));
  }

  function verifySpans(spans, error) {
    const entry = verifyLambdaEntry(spans, error);
    verifySdkExit(spans, entry);
  }

  function verifyLambdaEntry(spans, error) {
    return expectExactlyOneMatching(spans, span => {
      expect(span.t).to.exist;
      expect(span.p).to.not.exist;
      expect(span.s).to.exist;
      expect(span.n).to.equal('aws.lambda.entry');
      expect(span.k).to.equal(constants.ENTRY);
      expect(span.f).to.be.an('object');
      expect(span.f.h).to.not.exist;
      expect(span.f.hl).to.be.true;
      expect(span.f.cp).to.equal('aws');
      expect(span.f.e).to.equal(qualifiedArn);
      expect(span.async).to.not.exist;
      expect(span.data.lambda).to.be.an('object');
      expect(span.data.lambda.runtime).to.equal('nodejs');
      if (error) {
        expect(span.data.lambda.error).to.equal('Boom!');
        expect(span.error).to.not.exist;
        expect(span.ec).to.equal(1);
      } else {
        expect(span.data.lambda.error).to.not.exist;
        expect(span.error).to.not.exist;
        expect(span.ec).to.equal(0);
      }
      verifyHeaders(span);
    });
  }

  function verifySdkExit(spans, entry) {
    return expectExactlyOneMatching(spans, span => {
      expect(span.t).to.equal(entry.t);
      expect(span.p).to.equal(entry.s);
      expect(span.s).to.exist;
      expect(span.n).to.equal('sdk');
      expect(span.k).to.equal(constants.EXIT);
      expect(span.f).to.be.an('object');
      expect(span.f.h).to.not.exist;
      expect(span.f.cp).to.equal('aws');
      expect(span.f.hl).to.be.true;
      expect(span.f.e).to.equal(qualifiedArn);
      expect(span.async).to.not.exist;
      expect(span.data.sdk).to.be.an('object');
      expect(span.data.sdk.name).to.equal('custom-span');
      expect(span.data.sdk.type).to.equal('exit');
      verifyHeaders(span);
    });
  }

  function verifyNoMetrics(control) {
    return control.getMetrics().then(metrics => {
      expect(metrics).to.be.empty;
    });
  }

  function getAndVerifyMetrics(control) {
    return control.getMetrics().then(metrics => verifyMetrics(metrics));
  }

  function verifyMetrics(allMetrics) {
    expect(allMetrics).to.exist;
    expect(Array.isArray(allMetrics)).to.be.true;
    expect(allMetrics).to.have.lengthOf(1);
    const allPlugins = allMetrics[0];
    expect(allPlugins.plugins).to.have.lengthOf(1);
    const pluginData = allPlugins.plugins[0];
    expect(pluginData.data).to.exist;
    expect(pluginData.name).to.equal('com.instana.plugin.aws.lambda');
    expect(pluginData.entityId).to.equal(qualifiedArn);
    const metrics = pluginData.data;
    expect(metrics.sensorVersion).to.match(/1\.\d\d+\.\d+/);
    expect(metrics.startTime).to.be.at.most(Date.now());
    expect(metrics.versions).to.be.an('object');
    expect(metrics.versions.node).to.match(/\d+\.\d+\.\d+/);
    expect(metrics.versions.v8).to.match(/\d+\.\d+\.\d+/);
    expect(metrics.versions.uv).to.match(/\d+\.\d+\.\d+/);
    expect(metrics.versions.zlib).to.match(/\d+\.\d+\.\d+/);
    expect(metrics.npmPackageDescription).to.equal('Instana tracing and monitoring for Node.js based AWS Lambdas');
    expect(metrics.npmPackageName).to.equal('@instana/aws-lambda');
    expect(metrics.npmPackageVersion).to.match(/\d+\.\d+\.\d+/);
    verifyHeaders(allPlugins);
  }

  function verifyHeaders(payload) {
    const headers = payload._receivedHeaders;
    expect(headers).to.exist;
    expect(headers['x-instana-host']).to.equal(qualifiedArn);
    expect(headers['x-instana-key']).to.equal(instanaAgentKey);
    expect(headers['x-instana-time']).to.be.a('string');
  }
});
