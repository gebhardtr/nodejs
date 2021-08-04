/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2021
 */

'use strict';

const cls = require('../../../../cls');
const { EXIT, isExitSpan, sqsAttributeNames } = require('../../../../constants');
const tracingUtil = require('../../../../tracingUtil');
const { InstanaAWSProduct } = require('./instana_aws_product');

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
      return this.instrumentEntry(ctx, originalInnerLoggerMiddleware, originalInnerFuncArgs, originalParentFuncArgs);
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

  instrumentEntry(ctx, originalInnerLoggerMiddleware, originalInnerFuncArgs, originalParentFuncArgs) {
    return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
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
}

module.exports = new InstanaAWSSQS(SPAN_NAME, operations);
