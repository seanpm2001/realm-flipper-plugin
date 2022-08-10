import React, {useEffect} from 'react';
import {Text} from 'react-native';
import {addPlugin, Flipper} from 'react-native-flipper';
import Realm, {CanonicalObjectSchemaProperty} from 'realm';

const {BSON} = Realm;
// config: Configuration,
//     realms: Realm[],
//     connection: Flipper.FlipperConnection,

type PluginConfig = {
  realms: Realm[];
  connection: Flipper.FlipperConnection;
};

type getObjectsQuery = {
  schema: string;
  realm: string;
  cursorId: number;
  filterCursor: number | string;
  limit: number;
  sortingColumn: string;
  prev_page_cursorId: number;
  prev_page_filterCursor: number;
};

// convert object from a schema to realm one
const typeConverter = (object: any, realm: Realm, schemaName?: string) => {
  if (!schemaName) {
    throw new Error('Converting with missing schema name');
  }

  const convertLeaf = (value: any, typeName: string) => {
    console.log('convertLeaf', value, typeName);
    const schemaObj = realm.schema.find(schema => schema.name === typeName);
    let objectType;
    if (schemaObj) {
      // if found the schema, then we are dealing with an object
      typeName = 'object';
      objectType = schemaObj.name;
    }
    switch (typeName) {
      case 'object':
        return value === null
          ? null
          : realm.objectForPrimaryKey(
              objectType as string,
              value[schemaObj?.primaryKey as string],
            );
      case 'uuid':
        return new BSON.UUID(value);
      case 'decimal128':
        return new BSON.Decimal128(value);
      case 'objectID':
        return new BSON.ObjectId(value);
      case 'data':
        const typedArray = Uint8Array.from(value);
        return typedArray.buffer;
      default:
        console.log('returning default', value)
        return value;
    }
  };

  // console.log('converting...', object);
  const convertRoot = (val: any, property: CanonicalObjectSchemaProperty) => {
    console.log('convertRoot', val, property);

    if (val === null) {
      return null;
    }
    // console.log('got type', type);
    switch (property.type) {
      case 'set':
        console.log('received set:', val);
        // due to a problem with serialization, Set is being passed over as a list
        const realVal = (val as any[]).map(value => {
          return convertLeaf(value, property.objectType);
        });
        return realVal;
      case 'list':
        console.log('prop:', property, ' val:', val);
        return val.map(obj => {
          return convertLeaf(obj, property.objectType);
        });
      case 'dictionary':
        return val;
      default:
        return convertLeaf(val, property.type);
    }
  };

  const schemaObj = realm.schema.find(schema => schema.name === schemaName);

  const obj = {};
  Object.entries(object).forEach((value: [string, unknown]) => {
    const type = schemaObj?.properties[value[0]];
    console.log('type is', type, 'for key', value[0]);
    console.log('type is', type);
    obj[value[0]] = convertRoot(value[1], type);
    console.log('value for', value[0], ' is ', obj[value[0]]);
  });
  // console.log('returning', obj);
  // console.log('example:', new BSON.UUID());
  return obj;
};

export default React.memo((props: {realms: Realm[]}) => {
  const DEFAULT_PAGE_SIZE = 100; //research right size for 0.5 second load time or possibly use a different variable.
  let realmsMap = new Map<string, Realm>();
  let schemaToObjects = new Map<string, Realm.Results<Realm.Object>>();

  const {realms} = props;
  useEffect(() => {
    realms.forEach(realm => {
      realmsMap.set(realm.path, realm);
    });
    addPlugin({
      getId() {
        return 'realm';
      },
      onConnect(connection) {
        console.log('connecting', connection);

        connection.receive('getRealms', () => {
          connection.send('getRealms', {
            realms: Array.from(realmsMap.keys()),
          });
        });

        connection.receive('getObjects', obj => {
          const realm = realmsMap.get(obj.realm);
          const schema = obj.schema;
          if (!realm) {
            return;
          }
          console.log('i got', obj, obj.filterCursor, obj.cursorId);
          let objects = realm.objects(schema);
          if (!objects.length) {
            connection.send('getObjects', {
              objects: objects,
              total: null,
              next_cursor: null,
              prev_cursor: null,
            });
            return;
          }
          console.log('initially got objects', objects[0]);
          if (schemaToObjects.has(schema)) {
            console.log('removing all listeners from ', schema);
            schemaToObjects.get(schema).removeAllListeners();
          }
          console.log('adding listener to', schema);
          if (obj.sortingColumn) {
            objects
              .sorted([
                [`${obj.sortingColumn}`, false],
                ['_id', false],
              ])
              .addListener(onObjectsChange);
          } else {
            objects.sorted('_id').addListener(onObjectsChange);
          }
          console.log('i got', obj);
          schemaToObjects.set(schema, objects.sorted('_id'));
          let limit = obj.limit || DEFAULT_PAGE_SIZE;
          limit < 1 ? (limit = 20) : {};
          const objectsLength = objects.length;
          if (obj.backwards) {
            objects = getObjectsByPaginationBackwards(obj, objects, limit);
          } else {
            objects = getObjectsByPagination(obj, objects, limit);
          }
          let lastItem, firstItem;
          if (objects.length) {
            lastItem = objects[objects.length - 1]; //if this is null this is the last page
            firstItem = objects[0];
          }
          console.log('sending to client now');
          //base64 the next and prev cursors

          connection.send('getObjects', {
            objects: objects,
            total: objectsLength,
            next_cursor: lastItem,
            prev_cursor: firstItem,
          });
        });

        connection.receive(
          'getOneObject',
          (obj: {realm: string; schema: string; primaryKey: string}) => {
            const realm = realmsMap.get(obj.realm);

            currentRealm = realm;

            const schema = obj.schema;
            if (!realm) {
              return;
            }

            const object = realm.objectForPrimaryKey(schema, obj.primaryKey);

            connection.send('getOneObject', {object: object});
          },
        );

        connection.receive('getSchemas', obj => {
          const realm = realmsMap.get(obj.realm);
          if (!realm) {
            return;
          }
          const schemas = realm.schema;
          // for (let schema of realm.schema) {
          //   const objects = realm.objects(schema.name);
          //   if (schemaToObjects.has(schema.name)) {
          //     console.log('removing all listeners from ', schema.name);
          //     schemaToObjects.get(schema.name).removeAllListeners();
          //   }
          //   console.log('adding listener to', schema.name);
          //   objects.addListener(onObjectsChange);
          //   schemaToObjects.set(schema.name, objects);
          // }
          connection.send('getSchemas', {schemas: schemas});
        });

        connection.receive('executeQuery', (obj, responder) => {
          const realm = realmsMap.get(obj.realm);
          if (!realm) {
            return;
          }
          const objs = realm.objects(obj.schema);
          if (obj.query === '') {
            responder.success(objs);
            // connection.send('executeQuery', {result: objs});
            return;
          }

          let res;
          try {
            res = objs.filtered(obj.query);
            responder.success(res);
          } catch (err) {
            responder.error({message: err.message});
            // res = {result: err.message};
          }
          // responder.error(res);
          // connection.send('executeQuery', res);
        });
        connection.receive('addObject', obj => {
          const realm = realmsMap.get(obj.realm);
          if (!realm) {
            return;
          }
          const converted = typeConverter(obj.object, realm, obj.schema);
          console.log('trying to create:', converted);
          realm.write(() => {
            let t = realm.create(obj.schema, converted);
            console.log('created', t);
          });

          const objects = realm.objects(obj.schema);
          connection.send('getObjects', {objects: objects});
        });
        connection.receive('modifyObject', obj => {
          // console.log('modify', obj)
          const realm = realmsMap.get(obj.realm);
          if (!realm) {
            return;
          }
          const converted = typeConverter(obj.object, realm, obj.schema);
          console.log('converted', converted)
          realm.write(() => {
            realm.create(obj.schema, converted, 'modified');
          });

          const objects = realm.objects(obj.schema);
          connection.send('getObjects', {objects: objects});
        });
        connection.receive('removeObject', (obj, responder) => {
          const realm = realmsMap.get(obj.realm);
          if (!realm) {
            return;
          }

          const schema = realm.schema.find(
            schema => schema.name === obj.schema,
          );
          const primaryKey = schema?.primaryKey;
          if (!schema || !primaryKey) {
            return;
          }

          try {
            realm.write(() => {
              const realmObj = realm.objectForPrimaryKey(
                schema.name,
                obj.object[primaryKey],
              );
              realm.delete(realmObj);
            });
          } catch (err) {
            responder.error(err.message);
          }

          const objects = realm.objects(obj.schema);
          connection.send('getObjects', {objects: objects});
        });

        const onObjectsChange = (objects, changes) => {
          //console.log('objects', objects);
          console.log('changes', changes);
          console.log('small listener fires');
          changes.deletions.forEach(index => {
            if (connection) {
              connection.send('liveObjectDeleted', {index: index});
            }
          });
          // Handle newly added Dog objects
          changes.insertions.forEach(index => {
            const inserted = objects[index];
            const smallerNeighbor = objects[index - 1];
            const largerNeighbor = objects[index + 1];
            if (connection) {
              connection.send('liveObjectAdded', {
                newObject: inserted,
                index: index,
                smallerNeighbor: smallerNeighbor?._id,
                largerNeighbor: largerNeighbor?._id,
              });
            }
          });
          // Handle Dog objects that were modified
          changes.modifications.forEach(index => {
            const modified = objects[index];
            if (connection) {
              connection.send('liveObjectEdited', {
                newObject: modified,
                index: index,
              });
            }
          });
        };
      },
      onDisconnect() {
        for (let objects of schemaToObjects.values()) {
          objects.removeAllListeners();
        }
        console.log('Disconnected');
      },
    });
  });

  // function useForceUpdate() {
  //   const [value, setValue] = useState(0); // integer state
  //   return () => setValue(value => value + 1); // update state to force render
  //   // An function that increment 👆🏻 the previous state like here
  //   // is better than directly setting `value + 1`
  // }

  return <Text>dd</Text>;
});
function getObjectsByPagination(
  obj: getObjectsQuery,
  objects: Realm.Results<Realm.Object>,
  limit: number,
) {
  const shouldSortDescending = obj.sortDirection === 'descend';
  obj.cursorId =
    obj.cursorId ?? objects.sorted('_id', shouldSortDescending)[0]._id;
  if (shouldSortDescending) {
    objects = getObjectsDescending(obj, objects, limit);
  } else {
    objects = getObjectsAscending(obj, objects, limit);
  }
  return objects;
}

function getObjectsByPaginationBackwards(
  obj: getObjectsQuery,
  objects: Realm.Results<Realm.Object>,
  limit: number,
) {
  const shouldSortDescending = obj.sortDirection === 'descend';
  obj.prev_page_cursorId =
    obj.prev_page_cursorId ??
    objects.sorted('_id', shouldSortDescending)[0]._id;
  if (shouldSortDescending) {
    objects = getPrevObjectsDescending(obj, objects, limit);
  } else {
    objects = getPrevObjectsAscending(obj, objects, limit);
  }
  return objects;
}

function getPrevObjectsDescending(
  obj: getObjectsQuery,
  objects: Realm.Results<Realm.Object>,
  limit: number,
) {
  console.log('descending previous');
  if (obj.sortingColumn) {
    const filterCursor =
      obj.prev_page_filterCursor ??
      objects.sorted(`${obj.sortingColumn}`, false)[0][obj.sortingColumn];
    objects = objects
      .sorted([
        [`${obj.sortingColumn}`, false],
        ['_id', false],
      ])
      .filtered(
        `${obj.sortingColumn} ${
          !obj.prev_page_filterCursor ? '>=' : '>'
        } $0 || (${obj.sortingColumn} == $0 && _id ${
          obj.cursorId ? '>=' : '>'
        } $1) LIMIT(${limit + 1})`,
        filterCursor,
        obj.prev_page_cursorId,
      );
  } else {
    objects = objects
      .sorted('_id', false)
      .filtered(
        `_id ${obj.prev_page_cursorId ? '>=' : '>'} $0 LIMIT(${limit + 1})`,
        obj.prev_page_cursorId,
      );
  }
  if (obj.prev_page_filterCursor) {
    objects = objects.sorted([
      [`${obj.sortingColumn}`, true],
      ['_id', true],
    ]);
  } else if (obj.prev_page_cursorId) {
    objects = objects.sorted('_id', true);
  }
  return objects;
}

function getPrevObjectsAscending(
  obj: getObjectsQuery,
  objects: Realm.Results<Realm.Object>,
  limit: number,
) {
  console.log('ascending previous');
  if (obj.sortingColumn) {
    objects.findIndex
    const filterCursor =
      obj.filterCursor ??
      objects.sorted(`${obj.sortingColumn}`, true)[0][obj.sortingColumn];
    objects = objects
      .sorted([
        [`${obj.sortingColumn}`, true],
        ['_id', true],
      ])
      .filtered(
        `${obj.sortingColumn} ${
          !obj.prev_page_filterCursor ? '<=' : '<'
        } $0 || (${obj.sortingColumn} == $0 && _id ${
          obj.prev_page_cursorId ? '<=' : '<'
        } $1) LIMIT(${limit + 1})`,
        filterCursor,
        obj.prev_page_cursorId,
      );
  } else {
    objects = objects
      .sorted('_id', true)
      .filtered(
        `_id ${obj.prev_page_cursorId ? '<=' : '<'} $0 LIMIT(${limit + 1})`,
        obj.prev_page_cursorId,
      );
  }
  if (obj.prev_page_filterCursor) {
    objects = objects.sorted([
      [`${obj.sortingColumn}`, false],
      ['_id', false],
    ]);
  } else if (obj.prev_page_cursorId) {
    objects = objects.sorted('_id');
  }

  return objects;
}

function getObjectsDescending(
  obj: getObjectsQuery,
  objects: Realm.Results<Realm.Object>,
  limit: number,
) {
  if (obj.sortingColumn) {
    const filterCursor =
      obj.filterCursor ??
      objects.sorted(`${obj.sortingColumn}`, true)[0][obj.sortingColumn];
    console.log("filtercursor is ",obj.filterCursor);
    objects = objects
      .sorted([
        [`${obj.sortingColumn}`, true],
        ['_id', true],
      ])
      .filtered(
        `${obj.sortingColumn} ${!obj.filterCursor ? '<=' : '<'} $0 || (${obj.sortingColumn} == $0 && _id ${
          obj.cursorId ? '<=' : '<'
        } $1) LIMIT(${limit + 1})`,
        filterCursor,
        obj.cursorId,
      );
  } else {
    objects = objects
      .sorted('_id', true)
      .filtered(
        `_id ${obj.cursorId ? '<=' : '<'} $0 LIMIT(${limit + 1})`,
        obj.cursorId,
      );
  }
  return objects;
}

function getObjectsAscending(
  obj: getObjectsQuery,
  objects: Realm.Results<Realm.Object>,
  limit: number,
) {
  if (obj.sortingColumn) {
    const filterCursor =
      obj.filterCursor ??
      objects.sorted(`${obj.sortingColumn}`, false)[0][obj.sortingColumn];
    objects = objects
      .sorted([
        [`${obj.sortingColumn}`, false],
        ['_id', false],
      ])
      .filtered(
        `${obj.sortingColumn} ${!obj.filterCursor ? '>=' : '>'} $0 || (${
          obj.sortingColumn
        } == $0 && _id ${obj.cursorId ? '>=' : '>'} $1) LIMIT(${limit + 1})`,
        filterCursor,
        obj.cursorId,
      );
  } else {
    objects = objects
      .sorted('_id', false)
      .filtered(
        `_id ${obj.cursorId ? '>=' : '>'} $0 LIMIT(${limit + 1})`,
        obj.cursorId,
      );
  }
  return objects;
}
