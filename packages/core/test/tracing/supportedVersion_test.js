/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2019
 */

'use strict';

const expect = require('chai').expect;

const supportedTracingVersion = require('../../src/tracing/supportedVersion.js');

describe('supported versions for Node.js auto tracing', () => {
  it('must support various Node.js versions', () => {
    expect(supportedTracingVersion('6.0.0')).to.equal(true);
    expect(supportedTracingVersion('6.1.0')).to.equal(true);
    expect(supportedTracingVersion('6.2.0')).to.equal(true);
    expect(supportedTracingVersion('7.3.3')).to.equal(true);
    expect(supportedTracingVersion('8.2.1')).to.equal(true);
    expect(supportedTracingVersion('8.3.0')).to.equal(true);
    expect(supportedTracingVersion('8.9.1')).to.equal(true);
    expect(supportedTracingVersion('9.1.0')).to.equal(true);
    expect(supportedTracingVersion('9.2.0')).to.equal(true);
    expect(supportedTracingVersion('10.4.0')).to.equal(true);
    expect(supportedTracingVersion('10.13.0')).to.equal(true);
    expect(supportedTracingVersion('11.0.0')).to.equal(true);
    expect(supportedTracingVersion('11.1.0')).to.equal(true);
    expect(supportedTracingVersion('11.2.0')).to.equal(true);
    expect(supportedTracingVersion('11.3.0')).to.equal(true);
    expect(supportedTracingVersion('11.4.0')).to.equal(true);
    expect(supportedTracingVersion('11.5.0')).to.equal(true);
    expect(supportedTracingVersion('11.6.0')).to.equal(true);
    expect(supportedTracingVersion('12.0.0')).to.equal(true);
    expect(supportedTracingVersion('12.1.0')).to.equal(true);
    expect(supportedTracingVersion('13.0.0')).to.equal(true);
    expect(supportedTracingVersion('14.0.0')).to.equal(true);
    expect(supportedTracingVersion('15.0.0')).to.equal(true);
  });

  it('must report various Node.js versions as not supported', () => {
    expect(supportedTracingVersion('0.10.0')).to.equal(false);
    expect(supportedTracingVersion('0.12.0')).to.equal(false);
    expect(supportedTracingVersion('4.0.0')).to.equal(false);
    expect(supportedTracingVersion('4.9.1')).to.equal(false);
    expect(supportedTracingVersion('5.0.0')).to.equal(false);
    expect(supportedTracingVersion('5.12.0')).to.equal(false);
    expect(supportedTracingVersion('8.0.0')).to.equal(false);
    expect(supportedTracingVersion('8.1.4')).to.equal(false);
    expect(supportedTracingVersion('9.0.0')).to.equal(false);
    expect(supportedTracingVersion('10.0.0')).to.equal(false);
    expect(supportedTracingVersion('10.1.0')).to.equal(false);
    expect(supportedTracingVersion('10.2.0')).to.equal(false);
    expect(supportedTracingVersion('10.3.0')).to.equal(false);
  });
});
