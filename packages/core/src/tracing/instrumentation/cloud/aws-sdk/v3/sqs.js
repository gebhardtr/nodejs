/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2021
 */

'use strict';

const cls = require('../../../../cls');
const { ENTRY, EXIT, isExitSpan, sqsAttributeNames, snsSqsInstanaHeaderPrefixRegex } = require('../../../../constants');
const tracingUtil = require('../../../../tracingUtil');
const { InstanaAWSProduct } = require('./instana_aws_product');
let logger = require('../../../../../logger').getLogger('tracing/sqs', newLogger => {
  logger = newLogger;
});

const operationsInfo = {
  SendMessageBatchCommand: {
    sort: 'exit',
    type: 'batch.sync'
  },
  SendMessageCommand: {
    sort: 'exit',
    type: 'single.sync'
  },
  ReceiveMessageCommand: {
    sort: 'entry'
  }
};

const operations = Object.keys(operationsInfo);

const SPAN_NAME = 'sqs';

class InstanaAWSSQS extends InstanaAWSProduct {
  instrumentedInnerLoggerMiddleware(ctx, originalInnerLoggerMiddleware, originalInnerFuncArgs, originalParentFuncArgs) {
    const operation = operationsInfo[originalParentFuncArgs[1].commandName];

    if (operation && operation.sort === 'exit') {
      return this.instrumentExit(
        ctx,
        originalInnerLoggerMiddleware,
        originalInnerFuncArgs,
        originalParentFuncArgs,
        operation
      );
    } else if (operation && operation.sort === 'entry') {
      return this.instrumentEntry(
        ctx,
        originalInnerLoggerMiddleware,
        originalInnerFuncArgs,
        originalParentFuncArgs,
        operation
      );
    }

    return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
  }

  instrumentExit(ctx, originalInnerLoggerMiddleware, originalInnerFuncArgs, originalParentFuncArgs, operation) {
    const sendMessageInput = originalInnerFuncArgs[0].input;

    /**
     * Send Message Attribues format
     *  MessageAttributes: {
     *    CustomAttribute: {
     *      DataType: 'String',
     *      StringValue: 'Custom Value'
     *    }
     *  }
     */

    let attributes;
    const isBatch = sendMessageInput.Entries && sendMessageInput.Entries.length > 0;

    // Make sure that MessageAttributes is an existent object
    if (isBatch) {
      sendMessageInput.Entries.forEach(entry => {
        if (!entry.MessageAttributes) {
          entry.MessageAttributes = {};
        }
      });
    } else {
      attributes = sendMessageInput.MessageAttributes;
    }

    if (!attributes && !isBatch) {
      attributes = sendMessageInput.MessageAttributes = {};
    }

    if (cls.tracingSuppressed()) {
      if (isBatch) {
        sendMessageInput.Entries.forEach(entry => {
          this.propagateSuppression(entry.MessageAttributes);
        });
      } else {
        this.propagateSuppression(attributes);
      }
      return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
    }

    const parentSpan = cls.getCurrentSpan();

    if (!parentSpan || isExitSpan(parentSpan)) {
      return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
    }

    return cls.ns.runAndReturn(() => {
      const span = cls.startSpan(SPAN_NAME, EXIT);
      span.ts = Date.now();
      span.stack = tracingUtil.getStackTrace(this.instrumentExit, 2);
      span.data.sqs = this.buildSpanData(operation, sendMessageInput);

      if (isBatch) {
        span.data.sqs.size = sendMessageInput.Entries.length;
        sendMessageInput.Entries.forEach(entry => {
          this.propagateTraceContext(entry.MessageAttributes, span);
        });
      } else {
        this.propagateTraceContext(attributes, span);
      }

      const request = originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);

      request
        .then(data => {
          if (data && data.error) {
            this.finishSpan(data.error, span);
          } else {
            this.finishSpan(null, span);
          }
        })
        .catch(err => {
          this.finishSpan(err, span);
        });

      return request;
    });
  }

  instrumentEntry(ctx, originalInnerLoggerMiddleware, originalInnerFuncArgs, originalParentFuncArgs, operation) {
    const parentSpan = cls.getCurrentSpan();
    if (parentSpan) {
      logger.warn(
        // eslint-disable-next-line max-len
        `Cannot start an AWS SQS entry span when another span is already active. Currently, the following span is active: ${JSON.stringify(
          parentSpan
        )}`
      );
      return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
    }

    const sendMessageInput = originalInnerFuncArgs[0].input;

    return cls.ns.runAndReturn(() => {
      const span = cls.startSpan(SPAN_NAME, ENTRY);
      span.stack = tracingUtil.getStackTrace(this.instrumentEntry, 2);
      span.data.sqs = this.buildSpanData(operation, sendMessageInput);

      /**
       * The MessageAttributeNames attribute is an option that you tell which message attributes you want to see.
       * As we use message attributes to store Instana headers, if the customer does not set this attribute to All,
       * we cannot see the Instana headers, so we need to explicitly add them.
       */
      if (!sendMessageInput.MessageAttributeNames) {
        sendMessageInput.MessageAttributeNames = [];
      }

      if (
        !sendMessageInput.MessageAttributeNames.includes('X_INSTANA*') &&
        !sendMessageInput.MessageAttributeNames.includes('All')
      ) {
        sendMessageInput.MessageAttributeNames.push('X_INSTANA*');
      }

      const request = originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);

      request
        .then(data => {
          if (data && data.error) {
            this.addErrorToSpan(data.error, span);
            setImmediate(() => this.finishSpan(null, span));
          } else if (data && data.output && data.output.Messages && data.output.Messages.length > 0) {
            const messages = data.output.Messages;
            let tracingAttributes = this.readTracingAttributes(messages[0].MessageAttributes);
            if (!this.hasTracingAttributes(tracingAttributes)) {
              tracingAttributes = this.readTracingAttributesFromSns(messages[0].Body);
            }
            if (tracingAttributes.level === '0') {
              cls.setTracingLevel('0');
              setImmediate(() => span.cancel());
            }
            this.configureEntrySpan(span, data, tracingAttributes);
            setImmediate(() => this.finishSpan(null, span));
          } else {
            setImmediate(() => span.cancel());
          }
        })
        .catch(err => {
          this.addErrorToSpan(err, span);
          setImmediate(() => this.finishSpan(null, span));
        });

      return request;
    });
  }

  buildSpanData(operation, sendMessageInput) {
    return {
      sort: operation.sort,
      type: operation.type,
      // This parameter applies only to FIFO (first-in-first-out) queues.
      group: sendMessageInput.MessageGroupId,
      queue: sendMessageInput.QueueUrl
    };
  }

  propagateSuppression(attributes) {
    if (!attributes || typeof attributes !== 'object') {
      return;
    }

    attributes[sqsAttributeNames.LEVEL] = {
      DataType: 'String',
      StringValue: '0'
    };
  }

  propagateTraceContext(attributes, span) {
    if (!attributes || typeof attributes !== 'object') {
      return;
    }

    attributes[sqsAttributeNames.TRACE_ID] = {
      DataType: 'String',
      StringValue: span.t
    };

    attributes[sqsAttributeNames.SPAN_ID] = {
      DataType: 'String',
      StringValue: span.s
    };

    attributes[sqsAttributeNames.LEVEL] = {
      DataType: 'String',
      StringValue: '1'
    };
  }

  readMessageAttributeWithFallback(attributes, key1, key2) {
    const attribute =
      tracingUtil.readAttribCaseInsensitive(attributes, key1) ||
      tracingUtil.readAttribCaseInsensitive(attributes, key2);
    if (attribute) {
      // attribute.stringValue is used by SQS message attributes, attribute.Value is used by SNS-to-SQS.
      return attribute.StringValue || attribute.Value;
    }
  }

  /**
   * Reads all trace context relevant message attributes from an incoming message and provides them in a normalized
   * format for later processing.
   */
  readTracingAttributes(sqsAttributes) {
    const tracingAttributes = {};
    if (!sqsAttributes) {
      return tracingAttributes;
    }

    tracingAttributes.traceId = this.readMessageAttributeWithFallback(
      sqsAttributes,
      sqsAttributeNames.TRACE_ID,
      sqsAttributeNames.LEGACY_TRACE_ID
    );
    tracingAttributes.parentId = this.readMessageAttributeWithFallback(
      sqsAttributes,
      sqsAttributeNames.SPAN_ID,
      sqsAttributeNames.LEGACY_SPAN_ID
    );
    tracingAttributes.level = this.readMessageAttributeWithFallback(
      sqsAttributes,
      sqsAttributeNames.LEVEL,
      sqsAttributeNames.LEGACY_LEVEL
    );

    return tracingAttributes;
  }

  /**
   * Checks whether the given tracingAttributes object has at least one attribute set, that is, if there have been
   * Instana message attributes present when converting message attributes into this object.
   */
  hasTracingAttributes(tracingAttributes) {
    return tracingAttributes.traceId != null || tracingAttributes.parentId != null || tracingAttributes.level != null;
  }

  /**
   * Add extra info to the entry span after messages are received
   * @param {*} span The SQS Span
   * @param {*} data The data returned by the SQS API
   * @param {*} tracingAttributes The message attributes relevant for tracing
   */
  configureEntrySpan(span, data, tracingAttributes) {
    span.data.sqs.size = data.output.Messages.length;
    span.ts = Date.now();

    if (tracingAttributes.traceId && tracingAttributes.parentId) {
      span.t = tracingAttributes.traceId;
      span.p = tracingAttributes.parentId;
    }
  }

  readTracingAttributesFromSns(messageBody) {
    const tracingAttributes = {};
    // Parsing the message body introduces a tiny overhead which we want to avoid unless we are sure that the incoming
    // message actually has tracing attributes. Thus some preliminary, cheaper checks are executed first.
    if (
      typeof messageBody === 'string' &&
      messageBody.startsWith('{') &&
      messageBody.includes('"Type":"Notification"') &&
      snsSqsInstanaHeaderPrefixRegex.test(messageBody)
    ) {
      try {
        const parsedBody = JSON.parse(messageBody);
        if (parsedBody && parsedBody.MessageAttributes) {
          tracingAttributes.traceId = this.readMessageAttributeWithFallback(
            parsedBody.MessageAttributes,
            sqsAttributeNames.TRACE_ID,
            sqsAttributeNames.LEGACY_TRACE_ID
          );
          tracingAttributes.parentId = this.readMessageAttributeWithFallback(
            parsedBody.MessageAttributes,
            sqsAttributeNames.SPAN_ID,
            sqsAttributeNames.LEGACY_SPAN_ID
          );
          tracingAttributes.level = this.readMessageAttributeWithFallback(
            parsedBody.MessageAttributes,
            sqsAttributeNames.LEVEL,
            sqsAttributeNames.LEGACY_LEVEL
          );
        }
      } catch (e) {
        // The attempt to parse the message body as JSON failed, so this is not an SQS message resulting from an SNS
        // notification (SNS-to-SQS subscription), in which case we are not interested in the body. Ignore the error and
        // move on.
      }
    }
    return tracingAttributes;
  }
}

module.exports = new InstanaAWSSQS(SPAN_NAME, operations);
