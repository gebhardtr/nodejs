# Contributing

## Local Set Up

Note: You might need to install `libpq-dev`/`postgresql-devel` or a similar package before running `npm install` because `pg-native` depends on it. (`@instana/collector` and friends do not depend on `pg-native` but our test suite depends on it.)

After cloning the repository, run `npm install` in the root of the repository. This will install `lerna` as a local dependency and also bootstrap all packages (by running `npm install` in the individual packages, `packages/core`, `packages/collector`, ...). It can be convenient to have `lerna` installed globally to be able to run lerna commands directly from the command line, but it is not strictly necessary.

Make sure that your IDE is parsing .prettierrc. Otherwise, install the necessary plugins to make it so.

Troubleshooting `pg_config: command not found`: The tests in this package depend on (among others) `pg-native` and that in turn depends on the native add-on `libpq`. That add-on might try to call `pg_config` during `npm install`. If `npm install` terminates with `pg_config: command not found`, install the PostgreSQL package for your system (e.g. `brew install postgresql` or similar). If you do not want to run any tests, you can also omit this step and install dependencies with `npm install --production` instead.

## Executing Tests Locally

Some of the tests require infrastructure components (databases etc.) to run locally. The easiest way to run all required components locally is to use Docker and on top of this [Docker Compose](https://docs.docker.com/compose/). Start the script `bin/start-test-containers.sh` to set up all the necessary infrastructure. Once this is up, leave it running and, in second shell, start `bin/run-tests.sh`. This will set the necessary environment variables and kick off the tests.

If you want to see the Node.js collector's debug output while running the tests, make sure the environment variable `WITH_STDOUT` is set to a non-empty string. You can also use `npm run test:debug` instead of `npm test` to achieve this.

## How to Contribute

This is an open source project, and we appreciate your help!

In order to clarify the intellectual property license granted with contributions from any person or entity, a Contributor License Agreement ("CLA") must be on file that has been signed by each contributor, indicating agreement to the license terms below. This license is for your protection as a contributor as well as the protection of Instana and its customers; it does not change your rights to use your own contributions for any other purpose.

Please print, fill out, and sign the [contributor license agreement](https://github.com/instana/nodejs/raw/main/misc/instana-nodejs-cla-individual.pdf). Once completed, please scan the document as a PDF file and email to the following email address: bastian.krol@instana.com.

Thank you for your interest in the Instana Node.js project!

## Release Process

### When Adding A New Package

Reminder for all new packages: Check if `.circleci/config.yml` has `save_cache`/`restore_cache` entries for the new package.

When adding a new _scoped_ package (that is, `@instana/something` in contrast to `instana-something`), it needs to be configured to have public access, because scoped packages are private by default. Thus the publish would fail with something like `npm ERR! You must sign up for private packages: @instana/something`. To prevent this, you can the configure access level beforehand globablly:

* Run `npm config list` and check if the global section (e.g. `/Users/$yourname/.npmrc`) contains `access = "public"`.
* If not, run `npm config set access public` and check again.
* Following that, all packages can be published as usual (see below).
* See also: https://github.com/lerna/lerna/issues/1821.
* Many roads lead to rome, you can also set the access level on a package level instead of globally. Or you can issue `lerna version` separately and then publish only the new package directly via `npm` from within its directory with `NPM_CONFIG_OTP={your token} npm publish --access public` before publishing all the remaining package from the root directory with `NPM_CONFIG_OTP={your token} lerna publish from-package && lerna bootstrap`. This is also the way to remedy a situation where some of the packages have been published and some have not been published because you forgot to take care of the new package beforehand and the aforementioned error stopped the `lerna publish` in the middle. See [here](#separate-lerna-version-and-lerna-publish).

### Making A New Release

To make a release, you first need to ensure that the released version will either be a semver minor or patch release so that automatic updates are working for our users. Following that, the process is simple:

- Update `CHANGELOG.md` so that the unreleased section gets its version number. Commit and push this change.
- Acquire an OTP token for 2fa.
- Run either
    - `NPM_CONFIG_OTP={your token} lerna publish --force-publish="*" patch && lerna bootstrap`, or
    - `NPM_CONFIG_OTP={your token} lerna publish --force-publish="*" minor && lerna bootstrap`.

For each package release, we also publishing a new Lambda layer and a Fargate Docker image layer. This happens automatically via CI.

#### Separate lerna version And lerna publish

You might want to separate the version bumping and tagging from publishing to the npm registry. This is also possible. The separate lerna publish command (see below) is also helpful if the publish did not go through successfully.

- Run `lerna version --force-publish="*" patch` or `lerna version --force-publish="*" minor`, depending on which part of the version number has to be bumped. We should never have the need to bump the major version, so do not run `lerna version major`.
- Lerna will push the commit and the tag created by `lerna version` to GitHub. Check that this has happened. Also check that the version numbers in package-lock.json have been updated as well.
- Acquire an OTP token for 2fa.
- `NPM_CONFIG_OTP={your token} lerna publish from-package && lerna bootstrap`

That last command (`lerna publish from-package`) can also be run if the previous publish command went through for a subset of packages but not for others. Lerna will automatically figure out for which packages the latest version is not present in the registry and only publish those.

Be aware that if `lerna version` or `lerna publish` abort with an error in the middle of doing things, you might end up with local changes in the `package.json` files. Lerna adds some metadata there just before trying to publish. These changes can simply be discarded with `git checkout packages` before trying to publish again.

#### Rate Limited OTP

If publishing the packages fails with an error like this:

```
lerna ERR! E429 Could not authenticate ${npm-user-name}: rate limited otp
```

you simply need to wait five minutes before trying again. In case some packages have already been published and others have not, refer the advice about `lerna publish from-package` in the previous section.

