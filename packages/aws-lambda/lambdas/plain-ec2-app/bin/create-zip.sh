#!/usr/bin/env bash
set -eEuo pipefail

cd `dirname $BASH_SOURCE`/..

name=demo-ec2-app
echo "creating $name.zip"
rm -f $name.zip
mkdir -p ../zip
rm -f ../zip/$name.zip
rm -rf node_modules
zip -qr $name . -x bin/create-zip.sh -x \*.swp -x node_modules/*
mv $name.zip ../zip
