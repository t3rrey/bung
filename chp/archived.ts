import { createClient } from "@clickhouse/client";
import { z } from "zod";

// Define a schema for the event activities (e.g., sleepPassive, sleepRecharging)
const EventActivitySchema = z.tuple([
  z.string(), // activity name (sleepPassive, sleepRecharging, etc.)
  z.number(), // duration in hours
]);

// Define a schema for individual events
const IndividualEventSchema = z.tuple([
  z.number(), // duration of the event in hours
  z.array(z.number()).optional(), // optional location coordinates [longitude, latitude]
  z.array(EventActivitySchema), // array of activities that occurred during this event
]);

// Define the main event schema
const EventSchema = z.object({
  eventMessage: z.string(),
  severity: z.string(),
  totalDuration: z.number(),
  individualEvents: z.array(IndividualEventSchema),
});

const RootSchema = z.array(EventSchema);

export type Event = z.infer<typeof EventSchema>;
export type IndividualEvent = z.infer<typeof IndividualEventSchema>;
export type EventActivity = z.infer<typeof EventActivitySchema>;
export type SwarmBotEventData = z.infer<typeof RootSchema>;

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

async function testQuery(swarmbotIDs: string[] = ["sb-0130", "sb-0026"]) {
  const swarmbotIDsFormatted = swarmbotIDs.map((id) => `'${id}'`).join(", ");

  const result = await client.query({
    query: `
      SELECT
          eventMessage,
          severity,
          SUM(individualEventDuration) AS totalDuration,
          groupArray(
              (
                  individualEventDuration,
                  location,
                  individualEventDurationByState
              )
          ) AS individualEvents
      FROM
          (
              SELECT
                  downtimeEventID,
                  SUM(durationHr) AS individualEventDuration,
                  groupArray((state, durationHr)) AS individualEventDurationByState
              FROM
                  (
                      SELECT
                          downtimeEventID,
                          SUM(duration) / 1000 / 60 / 60 AS durationHr,
                          state
                      FROM
                          "metrics"
                      WHERE
                          downtimeEventID != ' '
                          AND date >= now() - INTERVAL 2 WEEK
                          AND swarmbotID IN (${swarmbotIDsFormatted})
                      GROUP BY
                          downtimeEventID,
                          state
                      ORDER BY
                          durationHr DESC
                  )
              GROUP BY
                  downtimeEventID
              ORDER BY
                  individualEventDuration DESC
          ) AS metric
          INNER JOIN (
              SELECT
                  eventMessage,
                  id,
                  severity,
                  location
              FROM
                  'swarmbot_events'
              WHERE
                  eventMessage != ''
                  AND (
                      severity = 'Unexpected'
                      OR severity = 'Expected'
                  )
          ) AS event ON toUUID(metric.downtimeEventID) = event.id
      GROUP BY
          eventMessage,
          severity
      ORDER BY
          totalDuration DESC
      LIMIT 2
    `,
    format: "JSONEachRow",
  });
  const data = await result.json();

  // Optional: Log the raw data to inspect its structure
  console.log("Raw data from ClickHouse:");
  console.log(JSON.stringify(data, null, 2));

  const parsedData = RootSchema.safeParse(data);

  if (parsedData.success) {
    console.log("Data is valid according to the schema.");
  } else {
    console.error(
      "Data validation failed:",
      JSON.stringify(parsedData.error.issues, null, 2)
    );
  }
}
