/**
 * Copyright 2017, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the `License`);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an `AS IS` BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const path = require(`path`);
const request = require(`request`);
const {Spanner} = require(`@google-cloud/spanner`);
const test = require(`ava`);
const tools = require(`@google-cloud/nodejs-repo-tools`);

const batchCmd = `node batch.js`;
const crudCmd = `node crud.js`;
const schemaCmd = `node schema.js`;
const indexingCmd = `node indexing.js`;
const transactionCmd = `node transaction.js`;
const timestampCmd = `node timestamp.js`;
const structCmd = `node struct.js`;
const dmlCmd = `node dml.js`;

const cwd = path.join(__dirname, `..`);

const date = Date.now();
const PROJECT_ID = process.env.GCLOUD_PROJECT;
const INSTANCE_ID = `test-instance-${date}`;
const DATABASE_ID = `test-database-${date}`;

const spanner = new Spanner({
  projectId: PROJECT_ID,
});

test.before(tools.checkCredentials);

test.before(async () => {
  const instance = spanner.instance(INSTANCE_ID);
  const database = instance.database(DATABASE_ID);

  try {
    await instance.delete();
  } catch (err) {
    // Ignore error
  }

  try {
    await database.delete();
  } catch (err) {
    // Ignore error
  }

  const [, operation] = await instance.create({
    config: 'regional-us-central1',
    nodes: 1,
    labels: {
      'gcloud-sample-tests': 'true',
    },
  });

  await operation.promise();
});

test.before(async () => {
  const [instances] = await spanner.getInstances({
    filter: 'labels.gcloud-sample-tests:true',
  });

  instances.forEach(async instance => {
    const {operations} = await getOperations(instance.metadata.name);

    operations
      .filter(operation => {
        return operation.metadata['@type'].includes('CreateInstance');
      })
      .filter(operation => {
        const yesterday = new Date();
        yesterday.setHours(-24);

        const instanceCreated = new Date(operation.metadata.startTime);

        return instanceCreated < yesterday;
      })
      .forEach(async () => await instance.delete());
  });
});

test.after.always(async () => {
  const instance = spanner.instance(INSTANCE_ID);
  const database = instance.database(DATABASE_ID);

  try {
    await database.delete();
  } catch (err) {
    // Ignore error
  }

  try {
    await instance.delete();
  } catch (err) {
    // Ignore error
  }
});

// create_database
test.serial(`should create an example database`, async t => {
  const results = await tools.runAsyncWithIO(
    `${schemaCmd} createDatabase "${INSTANCE_ID}" "${DATABASE_ID}" ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(
    output,
    new RegExp(`Waiting for operation on ${DATABASE_ID} to complete...`)
  );
  t.regex(
    output,
    new RegExp(`Created database ${DATABASE_ID} on instance ${INSTANCE_ID}.`)
  );
});

// insert_data
test.serial(`should insert rows into an example table`, async t => {
  const results = await tools.runAsyncWithIO(
    `${crudCmd} insert ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /Inserted data\./);
});

// query_data
test.serial(
  `should query an example table and return matching rows`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${crudCmd} query ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /SingerId: 1, AlbumId: 1, AlbumTitle: Total Junk/);
  }
);

// read_data
test.serial(`should read an example table`, async t => {
  const results = await tools.runAsyncWithIO(
    `${crudCmd} read ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /SingerId: 1, AlbumId: 1, AlbumTitle: Total Junk/);
});

// add_column
test.serial(`should add a column to a table`, async t => {
  const results = await tools.runAsyncWithIO(
    `${schemaCmd} addColumn ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /Waiting for operation to complete\.\.\./);
  t.regex(output, /Added the MarketingBudget column\./);
});

// update_data
test.serial(`should update existing rows in an example table`, async t => {
  const results = await tools.runAsyncWithIO(
    `${crudCmd} update ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /Updated data\./);
});

// read_stale_data
test.serial(`should read stale data from an example table`, t => {
  t.plan(2);
  // read-stale-data reads data that is exactly 15 seconds old.  So, make sure
  // 15 seconds have elapsed since the update_data test.
  return new Promise(resolve => setTimeout(resolve, 16000)).then(async () => {
    const results = await tools.runAsyncWithIO(
      `${crudCmd} read-stale ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(
      output,
      /SingerId: 1, AlbumId: 1, AlbumTitle: Total Junk, MarketingBudget: 100000/
    );
    t.regex(
      output,
      /SingerId: 2, AlbumId: 2, AlbumTitle: Forever Hold your Peace, MarketingBudget: 500000/
    );
  });
});

// query_data_with_new_column
test.serial(
  `should query an example table with an additional column and return matching rows`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${schemaCmd} queryNewColumn ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /SingerId: 1, AlbumId: 1, MarketingBudget: 100000/);
    t.regex(output, /SingerId: 2, AlbumId: 2, MarketingBudget: 500000/);
  }
);

// create_index
test.serial(`should create an index in an example table`, async t => {
  const results = await tools.runAsyncWithIO(
    `${indexingCmd} createIndex ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /Waiting for operation to complete\.\.\./);
  t.regex(output, /Added the AlbumsByAlbumTitle index\./);
});

// create_storing_index
test.serial(`should create a storing index in an example table`, async t => {
  const results = await tools.runAsyncWithIO(
    `${indexingCmd} createStoringIndex ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /Waiting for operation to complete\.\.\./);
  t.regex(output, /Added the AlbumsByAlbumTitle2 index\./);
});

// query_data_with_index
test.serial(
  `should query an example table with an index and return matching rows`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${indexingCmd} queryIndex ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /AlbumId: 2, AlbumTitle: Go, Go, Go, MarketingBudget:/);
    t.false(
      output.includes(`AlbumId: 1, AlbumTitle: Total Junk, MarketingBudget:`)
    );
  }
);

test.serial(
  `should respect query boundaries when querying an example table with an index`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${indexingCmd} queryIndex ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID} -s Ardvark -e Zoo`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /AlbumId: 1, AlbumTitle: Total Junk, MarketingBudget:/);
    t.regex(output, /AlbumId: 2, AlbumTitle: Go, Go, Go, MarketingBudget:/);
  }
);

// read_data_with_index
test.serial(`should read an example table with an index`, async t => {
  const results = await tools.runAsyncWithIO(
    `${indexingCmd} readIndex ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /AlbumId: 1, AlbumTitle: Total Junk/);
});

// read_data_with_storing_index
test.serial(`should read an example table with a storing index`, async t => {
  const results = await tools.runAsyncWithIO(
    `${indexingCmd} readStoringIndex ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /AlbumId: 1, AlbumTitle: Total Junk/);
});

// read_only_transaction
test.serial(`should read an example table using transactions`, async t => {
  const results = await tools.runAsyncWithIO(
    `${transactionCmd} readOnly ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /SingerId: 1, AlbumId: 1, AlbumTitle: Total Junk/);
  t.regex(output, /Successfully executed read-only transaction\./);
});

// read_write_transaction
test.serial(
  `should read from and write to an example table using transactions`,
  async t => {
    let results = await tools.runAsyncWithIO(
      `${transactionCmd} readWrite ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    let output = results.stdout + results.stderr;
    t.regex(output, /The first album's marketing budget: 100000/);
    t.regex(output, /The second album's marketing budget: 500000/);
    t.regex(
      output,
      /Successfully executed read-write transaction to transfer 200000 from Album 2 to Album 1./
    );

    results = await tools.runAsyncWithIO(
      `${schemaCmd} queryNewColumn ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    output = results.stdout + results.stderr;
    t.regex(output, /SingerId: 1, AlbumId: 1, MarketingBudget: 300000/);
    t.regex(output, /SingerId: 2, AlbumId: 2, MarketingBudget: 300000/);
  }
);

// create_query_partitions
test.serial(`should create query partitions`, async t => {
  const instance = spanner.instance(INSTANCE_ID);
  const database = instance.database(DATABASE_ID);
  const [transaction] = await database.createBatchTransaction();
  const identifier = JSON.stringify(transaction.identifier());

  const results = await tools.runAsyncWithIO(
    `${batchCmd} create-query-partitions ${INSTANCE_ID} ${DATABASE_ID} '${identifier}' ${PROJECT_ID}`,
    cwd
  );

  const output = results.stdout + results.stderr;

  t.regex(output, /Successfully created \d query partitions\./);

  await transaction.close();
});

// execute_partition
test.serial(`should execute a partition`, async t => {
  const instance = spanner.instance(INSTANCE_ID);
  const database = instance.database(DATABASE_ID);
  const [transaction] = await database.createBatchTransaction();
  const identifier = JSON.stringify(transaction.identifier());

  const query = `SELECT SingerId FROM Albums`;
  const [partitions] = await transaction.createQueryPartitions(query);
  const partition = JSON.stringify(partitions[0]);

  const results = await tools.runAsyncWithIO(
    `${batchCmd} execute-partition ${INSTANCE_ID} ${DATABASE_ID} '${identifier}' '${partition}' ${PROJECT_ID}`,
    cwd
  );

  const output = results.stdout + results.stderr;

  t.regex(output, /Successfully received \d from executed partition\./);

  await transaction.close();
});

// add_timestamp_column
test.serial(`should add a timestamp column to a table`, async t => {
  const results = await tools.runAsyncWithIO(
    `${timestampCmd} addTimestampColumn ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /Waiting for operation to complete\.\.\./);
  t.regex(
    output,
    /Added LastUpdateTime as a commit timestamp column in Albums table\./
  );
});

// update_data_with_timestamp_column
test.serial(
  `should update existing rows in an example table with commit timestamp column`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${timestampCmd} updateWithTimestamp ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Updated data\./);
  }
);

// query_data_with_timestamp_column
test.serial(
  `should query an example table with an additional timestamp column and return matching rows`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${timestampCmd} queryWithTimestamp ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(
      output,
      /SingerId: 1, AlbumId: 1, MarketingBudget: 1000000, LastUpdateTime:/
    );
    t.regex(
      output,
      /SingerId: 2, AlbumId: 2, MarketingBudget: 750000, LastUpdateTime:/
    );
  }
);

// create_table_with_timestamp_column
test.serial(
  `should create an example table with a timestamp column`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${timestampCmd} createTableWithTimestamp "${INSTANCE_ID}" "${DATABASE_ID}" ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(
      output,
      new RegExp(`Waiting for operation on ${DATABASE_ID} to complete...`)
    );
    t.regex(
      output,
      new RegExp(`Created table Performances in database ${DATABASE_ID}.`)
    );
  }
);

// insert_data_with_timestamp
test.serial(
  `should insert rows into an example table with timestamp column`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${timestampCmd} insertWithTimestamp ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Inserted data\./);
  }
);

// query_new_table_with_timestamp
test.serial(
  `should query an example table with a non-null timestamp column and return matching rows`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${timestampCmd} queryTableWithTimestamp ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /SingerId: 1, VenueId: 4, EventDate:/);
    t.regex(output, /Revenue: 15000, LastUpdateTime:/);
  }
);

// write_data_for_struct_queries
test.serial(
  `should insert rows into an example table for use with struct query examples`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${structCmd} writeDataForStructQueries ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Inserted data\./);
  }
);

// query_with_struct_param
test.serial(`should query an example table with a STRUCT param`, async t => {
  const results = await tools.runAsyncWithIO(
    `${structCmd} queryDataWithStruct ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
    cwd
  );
  const output = results.stdout + results.stderr;
  t.regex(output, /SingerId: 6/);
});

// query_with_array_of_struct_param
test.serial(
  `should query an example table with an array of STRUCT param`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${structCmd} queryWithArrayOfStruct ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /SingerId: 6\nSingerId: 7/);
  }
);

// query_with_struct_field_param
test.serial(
  `should query an example table with a STRUCT field param`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${structCmd} queryStructField ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /SingerId: 6/);
  }
);

// query_with_nested_struct_param
test.serial(
  `should query an example table with a nested STRUCT param`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${structCmd} queryNestedStructField ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(
      output,
      /SingerId: 6, SongName: Imagination\nSingerId: 9, SongName: Imagination/
    );
  }
);

// dml_standard_insert
test.serial(
  `should insert rows into an example table using a DML statement`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} insertUsingDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Successfully inserted 1 record into the Singers table/);
  }
);

// dml_standard_update
test.serial(
  `should update a row in an example table using a DML statement`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} updateUsingDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Successfully updated 1 record/);
  }
);

// dml_standard_delete
test.serial(
  `should delete a row from an example table using a DML statement`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} deleteUsingDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Successfully deleted 1 record\./);
  }
);

// dml_standard_update_with_timestamp
test.serial(
  `should update the timestamp of multiple records in an example table using a DML statement`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} updateUsingDmlWithTimestamp ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Successfully updated 2 records/);
  }
);

// dml_write_then_read
test.serial(
  `should insert a record in an example table using a DML statement and then query the record`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} writeAndReadUsingDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Timothy Campbell/);
  }
);

// dml_structs
test.serial(
  `should update a record in an example table using a DML statement along with a struct value`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} updateUsingDmlWithStruct ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Successfully updated 1 record/);
  }
);

// dml_getting_started_insert
test.serial(
  `should insert multiple records into an example table using a DML statement`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} writeUsingDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /4 records inserted/);
  }
);

// dml_getting_started_update
test.serial(
  `should transfer value from one record to another using DML statements within a transaction`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} writeWithTransactionUsingDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(
      output,
      /Successfully executed read-write transaction using DML to transfer 200000 from Album 1 to Album 2/
    );
  }
);

//  dml_partitioned_update
test.serial(
  `should update multiple records using a partitioned DML statement`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} updateUsingPartitionedDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Successfully updated 3 records/);
  }
);

//  dml_partitioned_delete
test.serial(
  `should delete multiple records using a partitioned DML statement`,
  async t => {
    const results = await tools.runAsyncWithIO(
      `${dmlCmd} deleteUsingPartitionedDml ${INSTANCE_ID} ${DATABASE_ID} ${PROJECT_ID}`,
      cwd
    );
    const output = results.stdout + results.stderr;
    t.regex(output, /Successfully deleted 5 records/);
  }
);

function apiRequest(reqOpts) {
  return new Promise((resolve, reject) => {
    spanner.auth
      .authorizeRequest(reqOpts)
      .then(reqOpts => {
        request(reqOpts, (err, response) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            resolve(JSON.parse(response.body));
          } catch (e) {
            reject(e);
            return;
          }
        });
      })
      .catch(reject);
  });
}

function getOperations(instanceName) {
  return apiRequest({
    uri: `https://spanner.googleapis.com/v1/${instanceName}/operations`,
  });
}
