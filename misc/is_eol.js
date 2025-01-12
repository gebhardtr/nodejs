#!/usr/bin/env node
/*
 * (c) Copyright IBM Corp. 2021
 * (c) Copyright Instana Inc. and contributors 2020
 */

'use strict';

/**
 * Exits with exit 1 if running on Node.js >= 10.x.y, otherwise with exit code 0.
 * That is, for EOL versions (4, 6, 8, ...), this script will pass and for non-EOL versions it will fail.
 */
if (parseInt(/v(\d+)\./.exec(process.version)[1], 10) >= 10) {
  process.exit(1);
} else {
  process.exit(0);
}
