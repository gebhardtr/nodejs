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

    // if (sendMessageInput.MessageAttributes == null) {
    //   sendMessageInput.MessageAttributes = {};
    // }

    /**
     * Send Message Attribues format
     * {
     *    ...
     *    MessageAttributes: {
     *      CustomAttribute: {
     *        DataType: 'String',
     *        StringValue: 'Custom Value'
     *      }
     *    }
     * }
     */
    // const messageBody = sendMessageInput.MessageBody;

    // if (!sendMessageInput || !messageBody) {
    //   return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
    // }

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
      const span = cls.startSpan('sqs', EXIT);
      span.ts = Date.now();
      span.stack = tracingUtil.getStackTrace(this.instrumentExit);
      span.data.sqs = {
        sort: operation.sort,
        type: operation.type,
        // This parameter applies only to FIFO (first-in-first-out) queues.
        group: sendMessageInput.MessageGroupId,
        queue: sendMessageInput.QueueUrl
      };

      if (isBatch) {
        span.data.sqs.size = sendMessageInput.Entries.length;
        sendMessageInput.Entries.forEach(entry => {
          this.propagateTraceContext(entry.MessageAttributes, span);
        });
      } else {
        this.propagateTraceContext(attributes, span);
      }

      // const request = originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
      const request = originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);

      request
        .then(data => {
          console.log('EH MTO SUCESSO CARA');
          this.finishSpan(null, span);
        })
        .catch(err => {
          console.log('VEIO AKI', err, span);
          this.finishSpan(err, span);
        });

      return request;

      //    const originalCallback = originalArgs[1];
      //    if (typeof originalCallback === 'function') {
      //      originalArgs[1] = cls.ns.bind(function (err, data) {
      //        finishSpan(err, data, span);
      //        originalCallback.apply(this, arguments);
      //      });
      //    }
      //    const awsRequest = originalSendMessage.apply(ctx, originalArgs);
      //    if (typeof awsRequest.promise === 'function') {
      //      awsRequest.promise = cls.ns.bind(awsRequest.promise);
      //    }
      //    // this is what the promise actually does
      //    awsRequest.on('complete', function onComplete(data) {
      //      if (data && data.error) {
      //        finishSpan(data.error, null, span);
      //        throw data.error;
      //      } else {
      //        finishSpan(null, data, span);
      //        return data;
      //      }
      //    });
      //    return awsRequest;
      // return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
    });

    // return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
  }

  instrumentEntry(ctx, originalInnerLoggerMiddleware, originalInnerFuncArgs, originalParentFuncArgs) {
    // console.log('hai, entry span', originalParentFuncArgs[1].commandName);
    return originalInnerLoggerMiddleware.apply(ctx, originalInnerFuncArgs);
  }

  buildSpanData(operation, params) {
    const methodInfo = operationsInfo[operation];
    const s3Data = {
      op: methodInfo.op
    };

    if (params && params.Bucket) {
      s3Data.bucket = params.Bucket;
    }

    if (methodInfo.hasKey) {
      s3Data.key = params.Key;
    }

    return s3Data;
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
