import { MongoClient, type MongoClientOptions } from "mongodb";

const MONGODB_URI =
  "mongodb+srv://vercel-admin-user-65769fd437294e6000502481:tat1O9sUB5G2cNzf@swarmfarm-robotics.b7vokux.mongodb.net/myFirstDatabase?retryWrites=true&w=majority";

if (!MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const options: MongoClientOptions = {
  connectTimeoutMS: 60000,
  serverSelectionTimeoutMS: 60000,
};
let client: MongoClient;

if (process.env.NODE_ENV === "development") {
  const globalWithMongo = global as typeof globalThis & {
    _mongoClient?: MongoClient;
  };

  if (!globalWithMongo._mongoClient) {
    globalWithMongo._mongoClient = new MongoClient(MONGODB_URI, options);
  }
  client = globalWithMongo._mongoClient;
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(MONGODB_URI, options);
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default client;
