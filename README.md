# Use Loopback/StrongLoop Database Connector Standalone

[Loopback](https://loopback.io/doc/en/lb3/index.html) is great.  But sometimes all you want is the database abstraction part of it,
not the entire application framework.  The use case that modivated me to write this little module is the following; I have a full
blown web application server written in Loopback with a database, but I also have small satellite application "services" that I
want to run serverless (as in AWS Lambda) that capture small messages from IoT devices and write those into the database.  I have no
need for the entire Loopback application framework in these small services, but I still want to use the Loopback ORM to write
the data.  These services do not need to update or migrate the database, they do not need swagger interfaces, they do not need
ACLs or any of that stuff ... the web application server takes care of all that.

## Usage

```sh
npm install loopback-orm
```

```js
const connector = {
  name: "postgres",
  connector: "postgresql",
  host: "192.168.99.100",
  port: 5432,
  url: "",
  database: "be",
  password: "secret",
  user: "admin",
};

const modelsPath = "/home/ubuntu/loopback-app/common/models";

const models = require('loopback-orm')({ connector, modelsPath });

models.MyModel.findOne({
  where: { id: 55 },
  fields: { type: true, timestamp: true },
  include: [ "relation1", "relation2" ]
}).then((res) => {
  console.log( JSON.stringify( res, null, 2 ) );
});
```

The `connector` specification is as described [here](https://loopback.io/doc/en/lb3/Defining-data-sources.html).  The `modelsPath` can
be a path in the file system to the models directory created in a loopback app, typically "common/models", 
described [here](https://loopback.io/doc/en/lb3/Customizing-models.html).

> *NOTE* If you employ custom base classes for your models, see Custom Base Classes below

Discovery is also supported, and is triggered if you pass `discovery: true` as an option to this module.  In this case, an attempt is made to
discover the models from just inspecting the database.  This is somewhat limited however in regards to relations.  It handles `belongsTo`
relations so long as you explicity describe your foreign keys and what they point to when you design the database schema.  In addition, this module
cannot inflate and deflate "object" columns, since those are done only if a schema is known.
 
In discovery mode, the call is asynchronious and returns a promise, so the usage is a little different:

```js
const db = require('loopback-orm');
db({ connector, discovery: true}).then((models) => {
  models.MyModel.findOne({
    where: { id: 55 },
    fields: { type: true, timestamp: true },
  }).then((res) => {
    console.log( JSON.stringify( res, null, 2 ) );
  });
});
```

You can make the relations situation better in discovery mode by passing in `relations` option, a partial schema where each model has "relations" 
but no "properties".  Like so:

```js
const db = require('loopback-orm');

const relations = [
  {
    "name": "Config",
    "relations": {
      "State": {
        "type": "hasOne",
        "model": "State",
        "foreignKey": "configId"
      }
    }
  }
];

db({ connector, discovery: true, relations }).then((models) => {
  models.Config.findOne({
    where: { id: 55 },
    include: "State"
  }).then((m) => {
    console.log( JSON.stringify( m, null, 2 ) );
    process.exit(0);
  }).catch((err) => {
    console.log(err);
    process.exit(1);
  });
}).catch((err) => {
  console.log(err);
  process.exit(1);
});
```

See the Loopback documentation for how to describe relations.

## Database Sync

This module now supports database syncing ... schema creation and schema modifications based on the supplied models.  You just add a `sync: true`
in the options, and treat this module as a promise.

```js
const connector = {
  sync: true,
  name: "postgres",
  connector: "postgresql",
  host: "192.168.99.100",
  port: 5432,
  url: "",
  database: "be",
  password: "secret",
  user: "admin",
};
const modelsPath = require('path').resolve('./models');
const p = require('loopback-orm');
p({ connector, modelsPath, sync: true }).then((res) => {
  console.log( res.status );
  const models = res.models;
  Object.keys(models).forEach((modelName) => {
    console.log( `=> ${modelName}` );
  });
  process.exit();
}).catch((err) => {
  console.log( 'Error:', err.message );
});
```

## Custom Base Classes

If you are using custom base classes in your model definitions, you have to so something a little different or things won't work.  
You need to create your own array of model definitions with base class definitions at the front of the array, and call 
`({ connector, schemas: array-of-schemas, modelsPath })`.

When building your own array of model definitions, you must ensure your custom base classes come first in the array,
before any classes that use them.  And you must specify the "base" classname in the "options" section of each model
in addition to it being at the top of the model definition hierarchy.  Here is some reference code you can use for
reading your "/common/models" directory and dealing with a custom base class named "MyBase":

```js
const lodash = require('lodash');

function loadSchemas( dirPath ) {
  let schemas = [];
  let files = require('fs').readdirSync( dirPath );
  files.forEach((f) => {
    if ( f.match(/\.json$/ ) ) {
      let s = require( require('path').join( dirPath, f ) );
      // If it has a custom base, copy it to options
      if ( s.base === "MyBase" ) {
        if ( ! s.options ) s.options = {};
        s.options.base = s.base;
      }
      schemas.push( s );
    }
  });

  // Move "MyBase" model definition to the front of the schemas array
  let myBase = _.find(schemas, {name: "MyBase"});
  schemas = _.reject(schemas, {name: "MyBase"});
  schemas.unshift(MyBase);

  return schemas;
}

models = require('loopback-orm')({
  connector,
  schemas: loadSchemas(require('path').resolve("./common/models")),
  modelsPath: require('path').resolve("./common/models")
});
```

## Mixins

If your model schemas use mixins, then you can pass in a `mixins` option to the call.  "TimeStamp" is a popular
mixin for adding createdAt and updatedAt properties to model instances on creaton and update.  Here is an example
that supports the TimeStamp mixin (you must npm install loopback-ds-timestamp-mixin for this):

```js
models = require('loopback-orm')({
  mixins: {
    TimeStamp: require("./node_modules/loopback-ds-timestamp-mixin/time-stamp")
  },
  ...
});
```
