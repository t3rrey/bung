import type { Document } from "mongodb";
import { z } from "zod";
import client from "./client";

export enum GpsSettingsInput {
  JohnDeere = "JOHN_DEERE",
  Novatel = "NOVATEL",
  Topcon = "TOPCON",
  Trimble = "TRIMBLE",
}

const GenerationMethod = z.enum([
  "recorded",
  "buffered",
  "drawn",
  "uploaded",
  "generated",
  "manual",
  "unknown",
]);

const subFieldInfoSchema = z.object({
  generationMethod: GenerationMethod,
  operatingArea: GenerationMethod.optional(),
  geofence: GenerationMethod.optional(),
  greenArea: GenerationMethod.optional(),
  abLine: GenerationMethod.optional(),
});

// Define user type enum for clarity and type safety
const UserTypeEnum = z.enum(["staff", "customer"]);

const analyticsRequestSchema = z.object({
  category: z.string().min(1, "Category is required"),
  version: z.number().int("Version must be an integer"),
  date: z.string().datetime("Date must be a valid ISO 8601 date string"),
  userType: UserTypeEnum, // Use the enum here
  userDisplay: z.string().min(1, "User display name is required"),
  userID: z.string().min(1, "User ID is required"), // Keep userID in the schema for grouping
  channelDisplay: z.string().min(1, "Channel display name is required"),
  channelID: z.string().min(1, "Channel ID is required"),
  uploadMethod: z.enum([
    "manual",
    "paddock-recorder",
    "john-deere-setup-file",
    "john-deere-api-connection",
  ]),
  swarmBots: z.array(z.string()),
  runlineType: z.nativeEnum(GpsSettingsInput, {
    errorMap: () => ({
      message:
        "Run line type is required and must be a valid GpsSettingsInput enum value",
    }),
  }),
  numberOfHeadlandsToGenerate: z
    .number()
    .int()
    .min(0, "Number of headlands cannot be negative"),
  rowSpacing: z.number().positive("Row spacing must be a positive number"),
  offset: z.number(),
  subfields: z.array(subFieldInfoSchema),
  numberOfObstacles: z
    .number()
    .int()
    .min(0, "Number of obstacles cannot be negative"),
  fieldURL: z.string().url("Field URL must be a valid URL"),
  fieldID: z.string().min(1, "Field ID is required"),
});

export type AnalyticsRequest = z.infer<typeof analyticsRequestSchema>;
// Define a type alias for the user type values for convenience
export type UserType = z.infer<typeof UserTypeEnum>;

// Define a type for the expected facet result structure
// Updated topUsersByFieldCount to remove userID
interface AnalysisResults {
  userTypeDistribution: { userType: UserType; count: number }[];
  uploadMethodDistribution: { uploadMethod: string; count: number }[];
  subfieldCountDistribution: {
    numberOfSubfields: number;
    documentCount: number;
  }[];
  obstacleDistribution: {
    numberOfObstacles: number;
    count: number;
  }[];
  runlineTypeDistribution: {
    runlineType: GpsSettingsInput;
    count: number;
  }[];
  totalDocuments: { count: number }[];
  topUsersByFieldCount: {
    // userID is removed here
    userDisplay: string;
    userType: UserType;
    fieldCount: number;
  }[];
}

// --- Main Analysis Function ---

async function main() {
  try {
    // await client.connect(); // Uncomment if needed
    console.log("Connected successfully to server");

    const db = client.db("websites"); // Adjust DB name if necessary
    // Use Document type here for broader compatibility with aggregation results
    const collection = db.collection<Document>("analytics");

    console.log(`Querying collection: ${collection.collectionName}`);

    // --- Aggregation Pipeline (MODIFIED topUsersByFieldCount facet's $project) ---
    const analysisPipeline: Document[] = [
      {
        $facet: {
          // --- Existing Facets (Keep as they are) ---
          userTypeDistribution: [
            { $group: { _id: "$userType", count: { $sum: 1 } } },
            { $project: { userType: "$_id", count: 1, _id: 0 } },
          ],
          uploadMethodDistribution: [
            { $group: { _id: "$uploadMethod", count: { $sum: 1 } } },
            { $project: { uploadMethod: "$_id", count: 1, _id: 0 } },
            { $sort: { count: -1 } },
          ],
          subfieldCountDistribution: [
            { $addFields: { numberOfSubfields: { $size: "$subfields" } } },
            { $group: { _id: "$numberOfSubfields", count: { $sum: 1 } } },
            {
              $project: {
                numberOfSubfields: "$_id",
                documentCount: "$count",
                _id: 0,
              },
            },
            { $sort: { numberOfSubfields: 1 } },
          ],
          totalDocuments: [{ $count: "count" }],
          obstacleDistribution: [
            { $group: { _id: "$numberOfObstacles", count: { $sum: 1 } } },
            {
              $project: { _id: 0, numberOfObstacles: "$_id", count: 1 },
            },
            { $sort: { numberOfObstacles: 1 } },
          ],
          runlineTypeDistribution: [
            { $group: { _id: "$runlineType", count: { $sum: 1 } } },
            { $project: { _id: 0, runlineType: "$_id", count: 1 } },
            { $sort: { count: -1 } },
          ],

          // --- MODIFIED FACET: Top 10 Users (userID removed from final projection) ---
          topUsersByFieldCount: [
            {
              // Group by user identification fields (still need userID for correct grouping)
              $group: {
                _id: {
                  userID: "$userID",
                  userDisplay: "$userDisplay",
                },
                // Capture the userType (assuming it's consistent per user)
                userType: { $first: "$userType" }, // Use $first to grab the type
                // Count the documents (fields) for each user
                fieldCount: { $sum: 1 },
              },
            },
            {
              // Sort by the count in descending order
              $sort: { fieldCount: -1 },
            },
            {
              // Limit to the top 10
              $limit: 10,
            },
            {
              // Reshape the output (userID is NOT projected here)
              $project: {
                _id: 0, // Exclude the default _id field
                // userID: "$_id.userID", // <--- REMOVED THIS LINE
                userDisplay: "$_id.userDisplay", // Promote userDisplay
                userType: 1, // Include the captured userType
                fieldCount: 1, // Include the calculated fieldCount
              },
            },
          ],
        },
      },
    ];

    console.log("Executing aggregation pipeline...");
    // Execute the aggregation pipeline
    const results = await collection
      .aggregate<AnalysisResults>(analysisPipeline)
      .toArray();

    console.log("\n--- Analysis Results ---");

    // --- Check if results array is not empty ---
    if (results && results.length > 0) {
      const analysisData = results[0]; // Now TS knows this is AnalysisResults

      // Check if totalDocuments array exists and has an element
      const totalCount = analysisData?.totalDocuments?.[0]?.count ?? 0;
      console.log("\nTotal Documents Analyzed:", totalCount);

      if (totalCount > 0) {
        // --- Display User Type Distribution ---
        console.log("\nDistribution by User Type:");
        console.table(analysisData?.userTypeDistribution ?? []);
        if ((analysisData?.userTypeDistribution ?? []).length === 0) {
          console.log("- No user type data found.");
        }

        // --- Display Upload Method Distribution ---
        console.log("\nDistribution by Upload Method:");
        console.table(analysisData?.uploadMethodDistribution ?? []);
        if ((analysisData?.uploadMethodDistribution ?? []).length === 0) {
          console.log("- No upload method data found.");
        }

        // --- Display Subfield Count Distribution (using console.table) ---
        console.log("\nDistribution by Number of Subfields:");
        console.table(analysisData?.subfieldCountDistribution ?? []);
        if ((analysisData?.subfieldCountDistribution ?? []).length === 0) {
          console.log("- No subfield data found.");
        }

        // --- Display NEW Obstacle Distribution Table ---
        console.log("\nDistribution by Number of Obstacles:");
        console.table(analysisData?.obstacleDistribution ?? []);
        if ((analysisData?.obstacleDistribution ?? []).length === 0) {
          console.log("- No obstacle data found.");
        }

        // --- Display NEW Runline Type Distribution Table ---
        console.log("\nDistribution by Runline Type:");
        console.table(analysisData?.runlineTypeDistribution ?? []);
        if ((analysisData?.runlineTypeDistribution ?? []).length === 0) {
          console.log("- No runline type data found.");
        }

        // --- Display Top Users (userID column will be omitted by console.table) ---
        console.log("\nTop 10 Users by Field Count:");
        console.table(analysisData?.topUsersByFieldCount ?? []);
        if ((analysisData?.topUsersByFieldCount ?? []).length === 0) {
          console.log("- No user data found or collection empty.");
        }
      } else {
        console.log(
          "No documents matched the aggregation criteria (collection might be empty or filtered)."
        );
      }
    } else {
      // Handle the case where the aggregation returned no documents
      console.log(
        "No results returned from the aggregation pipeline. The collection might be empty."
      );
    }
  } catch (error) {
    console.error("An error occurred during analysis:", error);
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
    console.log("Database connection closed.");
  }
}

// Run the main function
main().catch(console.error);
