import { createClient } from "@clickhouse/client";

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

async function testQuery() {
  const result = await client.query({
    query: "SELECT * from raw_log LIMIT 10",
    format: "JSONEachRow",
  });
  const data = await result.json();

  console.log(data);
}

testQuery();
