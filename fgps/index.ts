import { readFileSync } from "fs";
import type {
  Feature,
  Position as GeoPosition,
  LineString,
  Polygon,
} from "geojson";
import { Server, Socket } from "net";
import { type GGAPacket } from "nmea-simple";

interface Position {
  latitude: number;
  longitude: number;
  altitude: number;
  satellitesInView: number;
  horizontalDilution: number;
}

interface CoordinateResult {
  coordinate: string;
  direction: string;
}

const PORT = 3006;
const HOST = "0.0.0.0";
const UPDATE_INTERVAL = 2000;
const GPS_FIX_TYPE = "rtk";
const GEOJSON_INPUT_PATH = "./test2.geojson";

// Global state for coordinate tracking
let coordinates: GeoPosition[] = [];
let currentIndex = 0;

function loadGeoJSON(filePath: string): void {
  try {
    const geojsonContent = readFileSync(filePath, "utf8");
    const feature: Feature = JSON.parse(geojsonContent);
    coordinates = [];

    if (feature.geometry.type === "LineString") {
      const lineString = feature.geometry as LineString;
      coordinates.push(...lineString.coordinates);
    } else if (feature.geometry.type === "Polygon") {
      const polygon = feature.geometry as Polygon;
      // For polygons, we use the outer ring (first array of coordinates)
      coordinates.push(...polygon.coordinates[0]);
    }

    console.log(`Loaded ${coordinates.length} coordinates from GeoJSON`);
  } catch (error) {
    console.error("Error loading GeoJSON:", error);
    throw error;
  }
}

function getNextPosition(): Position {
  const [longitude, latitude] = coordinates[currentIndex] as [number, number];

  // Move to next coordinate, loop back to start if at end
  currentIndex = (currentIndex + 1) % coordinates.length;

  return {
    latitude,
    longitude,
    altitude: 10.0 + (Math.random() - 0.5) * 0.1,
    satellitesInView: Math.floor(Math.random() * 4) + 8,
    horizontalDilution: 1.0 + Math.random() * 0.4,
  };
}

function convertLatLongToDMS(
  coordinate: number,
  isLongitude: boolean
): CoordinateResult {
  // Determine direction
  let direction: string;
  if (isLongitude) {
    direction = coordinate >= 0 ? "E" : "W";
  } else {
    direction = coordinate >= 0 ? "N" : "S";
  }

  // Convert to absolute value for calculation
  coordinate = Math.abs(coordinate);

  // Extract degrees (everything before decimal)
  const degrees = Math.floor(coordinate);

  // Convert decimal degrees to minutes
  const minutes = (coordinate - degrees) * 60;

  // Format degrees to ensure proper width (2 digits for lat, 3 for long)
  const degreesStr = isLongitude
    ? degrees.toString().padStart(3, "0")
    : degrees.toString().padStart(2, "0");

  // Format minutes to 8 decimal places for high precision
  const minutesStr = minutes.toFixed(8).padStart(11, "0");

  // Combine degrees and minutes
  const formattedCoordinate = `${degreesStr}${minutesStr}`;

  return {
    coordinate: formattedCoordinate,
    direction,
  };
}
function formatTime(date: Date): string {
  return (
    date.getUTCHours().toString().padStart(2, "0") +
    date.getUTCMinutes().toString().padStart(2, "0") +
    date.getUTCSeconds().toString().padStart(2, "0") +
    "." +
    date.getUTCMilliseconds().toString().padStart(3, "0")
  );
}

function getFakeGGAData(): GGAPacket {
  const position = getNextPosition();

  return {
    sentenceId: "GGA",
    time: new Date(),
    latitude: position.latitude,
    longitude: position.longitude,
    fixType: GPS_FIX_TYPE, // Always RTK mode
    satellitesInView: position.satellitesInView,
    horizontalDilution: position.horizontalDilution,
    altitudeMeters: 0, // Set to 0 due to pos2d mode
    geoidalSeperation: 0, // Set to 0 due to pos2d mode
    differentialAge: 1, // Added for RTK mode
    differentialRefStn: "0000", // Added for RTK mode
  };
}

function formatGGAMessage(data: GGAPacket): string {
  const lat = convertLatLongToDMS(data.latitude, false);
  const lon = convertLatLongToDMS(data.longitude, true);

  const fields = [
    "$GPGGA",
    formatTime(data.time),
    lat.coordinate,
    lat.direction,
    lon.coordinate,
    lon.direction,
    "4", // Changed to 4 for RTK fixed solution
    data.satellitesInView.toString().padStart(2, "0"),
    data.horizontalDilution.toFixed(1),
    "0.0", // Altitude always 0 in 2D mode
    "M",
    "0.0", // Geoidal separation always 0 in 2D mode
    "M",
    "1", // Differential age for RTK
    "0000", // Reference station
  ];

  const message = fields.join(",");
  const checksum = calculateChecksum(message);
  return `${message}*${checksum}\r\n`;
}

function calculateChecksum(message: string): string {
  let checksum = 0;
  for (let i = 1; i < message.length; i++) {
    checksum ^= message.charCodeAt(i);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

// Load coordinates at startup
loadGeoJSON(GEOJSON_INPUT_PATH);

// Create TCP server
const server = new Server();

// Handle client connections
server.on("connection", (socket: Socket) => {
  console.log("Client connected");

  const intervalId = setInterval(() => {
    const ggaData = getFakeGGAData();
    const message = formatGGAMessage(ggaData);
    socket.write(message);
  }, UPDATE_INTERVAL);

  socket.on("close", () => {
    console.log("Client disconnected");
    clearInterval(intervalId);
  });

  socket.on("error", (err: Error) => {
    console.error("Socket error:", err.message);
    clearInterval(intervalId);
  });
});

server.on("error", (err: Error) => {
  console.error("Server error:", err.message);
});

server.listen(PORT, HOST, () => {
  console.log(`NMEA GGA simulator running on port ${PORT}`);
  console.log(`GeoJSON path: ${GEOJSON_INPUT_PATH}`);

  const { networkInterfaces } = require("os");
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (!net.internal && net.family === "IPv4") {
        console.log(`  ${net.address}:${PORT}`);
      }
    }
  }
});
