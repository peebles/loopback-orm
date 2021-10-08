const DataSource = require( 'loopback-datasource-juggler' ).DataSource;
const ModelBuilder = require( 'loopback-datasource-juggler' ).ModelBuilder;
const _find = require( 'lodash.find' );
const fs = require( 'fs' );
const path = require( 'path' );

// loopback-datasource-juggler uses strong-globalize and g.error() to print some
// messages; specifically when there are temporary connection timeouts with MongoDB
// which by default end up on the console.  They are emitted as well, ... so lets
// disable the SG messages
const SG = require('strong-globalize');
SG.SetPersistentLogging(()=>{}, true /* disable console.log */); 

module.exports = function({connector, schemas, modelsPath, relations, mixins, sync, discovery}) {

  const makeDatasource = (name, connector) => {
    let ds = new DataSource(name, connector);
    // This prevents uncaught exceptions and allows database to reconnect
    ds.on("error", () => {});
    return ds;
  }

  const dbSync = (models) => {
    const dataSource = models[Object.keys(models)[0]].getDataSource();
    return new Promise((resolve, reject) => {
      dataSource.isActual((err, actual) => {
        if (err) return reject(err);
        if (actual) return resolve('datasource is up to date');
        dataSource.autoupdate((err) => {
          if (err) return reject(err);
          return resolve('datasource updated');
        });
      });
    });
  }

  const haveModels = () => {
    // Create the schemas array by reading all of the .json files in the given path
    function loadSchemas( dirPath ) {
      let schemas = [];
      let files = fs.readdirSync( dirPath );
      files.forEach((f) => {
        if ( f.match(/\.json$/ ) ) {
          let s = require( path.join( dirPath, f ) );
          schemas.push( s );
        }
      });
      return schemas;
    }

    const modelBuilder = new ModelBuilder();

    if (!schemas) schemas = loadSchemas( modelsPath );

    if (mixins) {
      Object.keys(mixins).forEach(mixinName => {
        let fcn = mixins[mixinName];
        modelBuilder.mixins.define(mixinName, fcn);
      });
      // re-arrange the schema structure to place the mixins into the right place
      let rewired = schemas.map(s => {
        if (s.mixins) delete s.mixins.GlobalBeforeRemote;
        return {
          ...s,
          options: {
            ...s.options,
            mixins: s.mixins,
            indexes: s.indexes
          }
        }
      });
      schemas = rewired;
    }
    
    const models = modelBuilder.buildModels( schemas );

    const dataSource = makeDatasource( connector.name, connector );

    Object.keys( models ).forEach((modelName) => {
      dataSource.attach( models[modelName] );
    });
    Object.keys( models ).forEach((modelName) => {
      dataSource.defineRelations( models[modelName], _find( schemas, { name: modelName } ).relations || {} );
    });
    Object.keys( models ).forEach((modelName) => {
      let mn = modelName;
      mn = mn.replace(/([A-Z])/g, (g) => `-${g[0].toLowerCase()}`).replace(/^-/, ''); // from internal camelcase back to fs
      let filename = `${path.join(modelsPath,mn)}.js`;
      if ( fs.existsSync(filename) ) {
        // have to noop stuff that does not exist outside of loopback
        models[modelName].remoteMethod = function(){};
        models[modelName].beforeRemote = function(){};
        models[modelName].afterRemote = function(){};
        require( path.join(modelsPath,mn) )(models[modelName]);
      }
    });

    return models;
  }

  //-- M A I N --

  // returns a promise
  if (sync === true) {
    let models = haveModels();
    let keys = Object.keys(models);
    if ( ! keys.length ) return Promise.reject(new Error('There are no model definitions to sync!'));
    return dbSync(models).then((status) => {
      return {status, models};
    });
  }

  // returns a promise
  if (discovery === true) {
    const dataSource = makeDatasource( connector.name, connector );
    return Promise.resolve().then(() => {
      return dataSource.discoverModelDefinitions();
    }).then((tables) => {
      let dbmodels = [];
      let promises = tables.map((table) => {
        return new Promise((resolve, reject) => {
          dataSource.discoverAndBuildModels( table.name, { relations: true }, (err, models) => {
            if ( err ) return reject( err );
            for (const modelName in models) {
              dbmodels[modelName] = models[modelName];
            }
            resolve();
          });
        });
      });
      return Promise.all(promises).then(() => {
        return dbmodels;
      }).then((models) => {
        if ( ! relations ) return models;
        Object.keys( models ).forEach((modelName) => {
          let model = _find( relations, { name: modelName } ) || {};
          dataSource.defineRelations( models[modelName], model.relations || {} );
        });
        return models;
      });
    });
  }

  // default, does NOT return a promise!  returns a hash who's keys are model names and values are model classes
  return haveModels();
}
