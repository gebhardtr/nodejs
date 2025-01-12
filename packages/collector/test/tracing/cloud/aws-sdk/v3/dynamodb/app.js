/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2021
 */

'use strict';

require('../../../../../../')();
const express = require('express');
const fetch = require('node-fetch');
const awsSdk3 = require('@aws-sdk/client-dynamodb');
const logPrefix = `AWS SDK v3 DynamoDB (${process.pid}):\t`;
const log = require('@instana/core/test/test_util/log').getLogger(logPrefix);
const port = process.env.APP_PORT || 3215;
const agentPort = process.env.INSTANA_AGENT_PORT || 42699;
const app = express();
const tableName = process.env.AWS_DYNAMODB_TABLE_NAME || 'nodejs-team';
const awsRegion = 'us-east-2';

const dynamoDB = new awsSdk3.DynamoDBClient({ region: awsRegion });
const dynamoDBv2 = new awsSdk3.DynamoDB({ region: awsRegion });

const tableCreationParams = {
  TableName: tableName,
  KeySchema: [
    { AttributeName: 'year', KeyType: 'HASH' },
    { AttributeName: 'title', KeyType: 'RANGE' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'year', AttributeType: 'N' },
    { AttributeName: 'title', AttributeType: 'S' }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5
  }
};

const itemKey = {
  year: {
    N: '2001'
  },
  title: {
    S: 'new record'
  }
};

const operationParams = {
  createTable: tableCreationParams,

  /**
   * Deleting table is not part of the instrumentation scope, as seen on Java and Go implementations.
   * However, we need to have this function in place to clean the table before starting tests
   */
  deleteTable: { TableName: tableName },
  listTables: {},
  scan: { TableName: tableName },
  query: {
    TableName: tableName,
    KeyConditionExpression: '#yr = :yyyy',
    ExpressionAttributeNames: {
      '#yr': 'year'
    },
    ExpressionAttributeValues: {
      ':yyyy': {
        N: '2001'
      }
    }
  },
  getItem: {
    TableName: tableName,
    Key: itemKey
  },
  deleteItem: {
    TableName: tableName,
    Key: itemKey
  },
  putItem: {
    TableName: tableName,
    Item: itemKey
  },
  updateItem: {
    TableName: tableName,
    Key: itemKey,
    AttributeUpdates: {
      author: {
        Value: {
          S: 'Neil Gaiman'
        }
      }
    }
  }
};

const availableOperations = Object.keys(operationParams);
const availableMethods = ['v3', 'v2', 'cb'];

function cap(str) {
  return str[0].toUpperCase() + str.substr(1);
}

function enforceErrors(options, operation) {
  options.InvalidDynamoDBKey = '999';

  if (operation === 'listTables') {
    options.Limit = 'this should be a number';
    options.ExclusiveStartTableName = {};
  }

  if (operation === 'createTable') {
    options.TableName = '';
  }

  if (operation === 'putItem') {
    options.Item = 'Invalid format';
  }

  if (operation === 'getItem' || operation === 'updateItem' || operation === 'deleteItem') {
    options.Key = 'Invalid format';
  }

  if (operation === 'scan' || operation === 'query') {
    options.ExpressionAttributeNames = -666;
  }
}

async function runV3AsPromise(withError, operation) {
  const options = operationParams[operation] || {};
  if (withError) {
    enforceErrors(options, operation);
  }

  const op = cap(`${operation}Command`);
  const command = new awsSdk3[op](options);
  const results = await dynamoDB.send(command);
  return results;
}

function runV3AsCallback(withError, operation, cb) {
  const options = operationParams[operation] || {};
  if (withError) {
    enforceErrors(options, operation);
  }

  const op = cap(`${operation}Command`);
  const command = new awsSdk3[op](options);
  dynamoDB.send(command, cb);
}

async function runV3AsV2Style(withError, operation) {
  const options = operationParams[operation] || {};
  if (withError) {
    enforceErrors(options, operation);
  }

  const results = await dynamoDBv2[operation](options);
  return results;
}

app.get('/', (_req, res) => {
  res.send('Ok');
});

availableOperations.forEach(op => {
  app.get(`/${op}/:method`, (req, res) => {
    const withError = typeof req.query.withError === 'string' && req.query.withError !== '';
    const method = req.params.method;

    switch (method) {
      case 'v3':
        runV3AsPromise(withError, op)
          .then(data => {
            return fetch(`http://127.0.0.1:${agentPort}`).then(() => data);
          })
          .then(data => {
            res.send({
              status: 'ok',
              result: data
            });
          })
          .catch(err => {
            res.status(500).send({ error: String(err) });
          });
        break;
      case 'v2':
        runV3AsV2Style(withError, op)
          .then(data => {
            return fetch(`http://127.0.0.1:${agentPort}`).then(() => data);
          })
          .then(data => {
            res.send({
              status: 'ok',
              result: data
            });
          })
          .catch(err => {
            res.status(500).send({ error: String(err) });
          });
        break;
      case 'cb':
        runV3AsCallback(withError, op, (err, data) => {
          if (err) {
            res.status(500).send({ error: String(err) });
          } else {
            fetch(`http://127.0.0.1:${agentPort}`).then(() => {
              res.send({
                status: 'ok',
                result: data
              });
            });
          }
        });
        break;
      default:
        res.status(500).send({ error: `URL must match one of the methods: ${availableMethods.join(', ')}` });
    }
  });
});

app.listen(port, () => log(`AWS SDK v3 DynamoDB app, listening to port ${port}`));
