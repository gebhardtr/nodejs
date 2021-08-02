/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2021
 */

'use strict';

// require('../../../../../../')();
const express = require('express');
const fetch = require('node-fetch');
const awsSdk3 = require('@aws-sdk/client-sqs');
const logPrefix = `AWS SDK v3 SQS Receiver (${process.pid}):\t`;
const log = require('@instana/core/test/test_util/log').getLogger(logPrefix);
// const delay = require('../../../../../../../core/test/test_util/delay');
const delay = require('@instana/core/test/test_util/delay');
const { sendToParent } = require('../../../../../../../core/test/test_util');
const port = process.env.APP_PORT || 3216;
const agentPort = process.env.INSTANA_AGENT_PORT || 42699;
const app = express();
const queueURL = process.env.AWS_SQS_QUEUE_URL;
const awsRegion = 'us-east-2';

const sqs = new awsSdk3.SQSClient({ region: awsRegion });
// const sqsv2 = new awsSdk3.SQS({ region: awsRegion });

let hasStartedPolling = false;

// const operationParams = {
//   QueueUrl: queueURL
// };

const receiveParams = {
  AttributeNames: ['SentTimestamp'],
  MaxNumberOfMessages: 10,
  MessageAttributeNames: ['All'],
  QueueUrl: queueURL,
  VisibilityTimeout: 5,
  // Please keep this value above 5, as tests can fail if not all messages are received
  WaitTimeSeconds: 7
};

app.get('/', (_req, res) => {
  if (hasStartedPolling) {
    res.send('OK');
  } else {
    res.status(500).send('Not ready yet.');
  }
});

async function runV3AsPromise() {
  const command = new awsSdk3.ReceiveMessageCommand(receiveParams);

  return sqs
    .send(command)
    .then(data => {
      if (data && data.error) {
        log('receive message data error', data.error);
        return;
      } else if (!data || !data.Messages || data.Messages.length === 0) {
        log('No messages, doing nothing');
        return;
      }

      data.Messages.forEach(message => {
        sendToParent(message);
      });

      log(
        'got messages:',
        data.Messages.map(m => m.MessageId)
      );

      const messagesForDeletion = data.Messages.map(message => {
        return {
          Id: message.MessageId,
          ReceiptHandle: message.ReceiptHandle
        };
      });

      const deletionCommand = new awsSdk3.DeleteMessageBatchCommand({
        QueueUrl: queueURL,
        Entries: messagesForDeletion
      });

      return sqs
        .send(deletionCommand)
        .then(() => delay(200))
        .then(() => fetch(`http://127.0.0.1:${agentPort}`))
        .then(() => delay(1000))
        .then(() => {
          log('The follow up request after receiving a message has happened.');
          // span.end();
        });
    })
    .catch(err => {
      log('message receiving/deleting failed', err);
      // span end with error
    });
}

async function pollForMessages() {
  const method = process.env.SQSV3_RECEIVE_METHOD || 'v3';

  log(`Polling SQS (type "${method}")`);

  switch (method) {
    case 'v3':
      try {
        await runV3AsPromise();
        setImmediate(pollForMessages);
      } catch (err) {
        log('error', err);
        // eslint-disable-next-line
        console.error(e);
        process.exit(1);
      }
      break;
    default:
  }

  // if (receivedType === 'v3') {
  //   try {
  //     await receivePromise();
  //   } catch (e) {
  //     // eslint-disable-next-line
  //     console.error(e);
  //     process.exit(1);
  //   }
  //   setImmediate(pollForMessages);
  // } else if (receivedType === 'cb') {
  //   receiveCallback(() => {
  //     setImmediate(pollForMessages);
  //   });
  // } else if (receivedType === 'v2') {
  //   try {
  //     await receiveAsync();
  //   } catch (e) {
  //     // eslint-disable-next-line
  //     console.error(e);
  //     process.exit(1);
  //   }
  //   setImmediate(pollForMessages);
  // } else {
  //   log(`End with command ${receivedType}`);
  // }
}

async function startPollingWhenReady() {
  // Make sure we are connected to the agent before calling sqs.receiveMessage for the first time.
  // if (instana.isConnected()) {
  pollForMessages();
  hasStartedPolling = true;
  // } else {
  //   await delay(50);
  //   setImmediate(startPollingWhenReady);
  // }
}

startPollingWhenReady();

app.listen(port, () => log(`AWS SDK v3 SQS receiver, listening to port ${port}`));
